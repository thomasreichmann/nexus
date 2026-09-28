import { vi } from 'vitest';
import { it, describe, expect } from '@nexus/db/test-db/integration';
import {
    insertFile,
    insertRetrieval,
    insertRetrievalRequest,
    insertRetrievalArtifact,
    backdateRetrievalRequest,
    type DB,
} from '@nexus/db/test-db';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import { InvalidStateError, NotFoundError } from '@/server/errors';

// The database is real; only AWS and the job queue are faked, so the tests
// below exercise the actual unique index, status columns and horizon SQL.
const s3Mocks = vi.hoisted(() => ({
    presignedGet: vi.fn(),
    // Objects default to archived — the case that needs a restore. Tests
    // about warm objects override this per-test.
    getObjectState: vi.fn(
        async (): Promise<ObjectState> => ({ availability: 'archived' })
    ),
}));

const jobMocks = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@/lib/storage', () => ({
    s3: {
        glacier: { getObjectState: s3Mocks.getObjectState },
        presigned: { get: s3Mocks.presignedGet },
    },
}));

vi.mock('@/lib/jobs', () => ({ jobs: { publish: jobMocks.publish } }));

import { retrievalService } from './retrieval';
import type { ObjectState } from '@nexus/db/objectState';
import type { RestoreHorizons, Retrieval } from '@nexus/db/repo/retrievals';

// Exercises the active-retrieval predicate against a real database: `ready`
// rows past `expiresAt` are expired by query, not by stored status — nothing
// tells us when a restored copy lapses. Two requests racing for one file's
// unique-index slot (#266) are in retrieval.concurrency.integration.test.ts.
// The repository's own queries, row by row, are pinned in @nexus/db's
// retrievals.integration.test.ts; these tests are about the service on top.

const HOUR_MS = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR_MS);
const future = () => new Date(Date.now() + HOUR_MS);
const readyNow = () => ({ readyAt: new Date(), expiresAt: future() });

// The worker's scans are global, oldest-first and limited, and this database
// is shared: a row created now sorts behind every older qualifying row and
// drops out of the limit once there are enough of them. A `created_at` older
// than any real row keeps a test's own rows inside it (#491).
const BEFORE_ANY_REAL_ROW = new Date('2000-01-01T00:00:00Z');

// Every suite here is `describe.concurrent`: each test owns its `user`, so
// their rows can't collide, and on the pooler the file runs in a fraction of
// its serial time. The price is that the mocks above are shared by tests in
// flight at once, so no test may install its own implementation or assert
// on their calls. A test that needs to belongs in a sequential file.

describe.concurrent('active-retrieval expiry predicate', () => {
    it('a lapsed ready retrieval no longer blocks a fresh request', async ({
        db,
        user,
    }) => {
        const file = await insertFile(db, { userId: user.id });
        const lapsed = await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'ready',
            readyAt: past(),
            expiresAt: past(),
        });

        await retrievalService.requestRetrieval(db, user.id, file.id);

        const repo = createRetrievalRepo(db);
        // Fresh row, waiting on the initiation job — the request path writes
        // rows and asks S3 nothing (#423).
        const [retrieval] = await repo.findByFileIds([file.id]);
        expect(retrieval.id).not.toBe(lapsed.id);
        expect(retrieval.status).toBe('pending');
        expect(retrieval.initiatedAt).toBeInstanceOf(Date);

        // The insert path flipped the lapsed row to `expired` — it has to,
        // or the row would still hold the unique-index slot for the file.
        const rows = await repo.findByUser(user.id);
        expect(rows.find((r) => r.id === lapsed.id)?.status).toBe('expired');
    });

    it('getDownloadUrl rejects a lapsed ready retrieval', async ({
        db,
        user,
    }) => {
        const file = await insertFile(db, { userId: user.id });
        await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'ready',
            readyAt: past(),
            expiresAt: past(),
        });

        await expect(
            retrievalService.getDownloadUrl(db, user.id, file.id)
        ).rejects.toThrow(InvalidStateError);
    });
});

// Request-level readiness against real SQL. The unit tests can only pin the
// all-or-nothing rule on top of a mocked aggregate; the counting itself — and
// the adoption case that made a join table necessary — needs the database.
describe.concurrent('a restore is one request (#422)', () => {
    it('counts every requested file and only flips ready on the last one', async ({
        db,
        user,
    }) => {
        const [first, second] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);

        const { requestId } = await retrievalService.requestBulkRetrieval(
            db,
            user.id,
            [first.id, second.id],
            'bulk'
        );

        const requestRepo = createRetrievalRequestRepo(db);
        expect(await requestRepo.findReadiness(requestId)).toEqual({
            totalFiles: 2,
            readyFiles: 0,
            isReady: false,
        });

        const retrievalRepo = createRetrievalRepo(db);
        const retrievalIdByFileId = new Map(
            (await retrievalRepo.findByFileIds([first.id, second.id])).map(
                (r) => [r.fileId, r.id]
            )
        );
        await retrievalRepo.updateStatus(
            retrievalIdByFileId.get(first.id)!,
            'ready',
            readyNow()
        );
        expect(await requestRepo.findReadiness(requestId)).toEqual({
            totalFiles: 2,
            readyFiles: 1,
            isReady: false,
        });

        await retrievalRepo.updateStatus(
            retrievalIdByFileId.get(second.id)!,
            'ready',
            readyNow()
        );
        expect(await requestRepo.findReadiness(requestId)).toEqual({
            totalFiles: 2,
            readyFiles: 2,
            isReady: true,
        });
    });

    it('two overlapping requests share one retrieval row and both count it', async ({
        db,
        user,
    }) => {
        const [shared, onlyFirst, onlySecond] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);

        const first = await retrievalService.requestBulkRetrieval(
            db,
            user.id,
            [shared.id, onlyFirst.id],
            'bulk'
        );
        const second = await retrievalService.requestBulkRetrieval(
            db,
            user.id,
            [shared.id, onlySecond.id],
            'bulk'
        );

        expect(second.requestId).not.toBe(first.requestId);

        // The unique index allows one active retrieval per file, so the second
        // request adopted the first's row instead of starting a second restore.
        const retrievalRepo = createRetrievalRepo(db);
        const [sharedRetrieval] = await retrievalRepo.findByFileIds([
            shared.id,
        ]);
        expect(sharedRetrieval).toBeDefined();

        // Both requests still own the shared file — the case a `request_id`
        // column on `retrievals` could not have expressed, since that one row
        // can only name a single request.
        const requestRepo = createRetrievalRequestRepo(db);
        expect(await requestRepo.findReadiness(first.requestId)).toMatchObject({
            totalFiles: 2,
            readyFiles: 0,
        });
        expect(await requestRepo.findReadiness(second.requestId)).toMatchObject(
            {
                totalFiles: 2,
                readyFiles: 0,
            }
        );

        await retrievalRepo.updateStatus(
            sharedRetrieval.id,
            'ready',
            readyNow()
        );
        expect(
            (await requestRepo.findReadiness(first.requestId)).readyFiles
        ).toBe(1);
        expect(
            (await requestRepo.findReadiness(second.requestId)).readyFiles
        ).toBe(1);
    });

    it('a lapsed ready retrieval stops counting toward its request', async ({
        db,
        user,
    }) => {
        const file = await insertFile(db, { userId: user.id });

        const { requestId } = await retrievalService.requestRetrieval(
            db,
            user.id,
            file.id
        );

        // Stand in for the initiation job finding the object already readable.
        const requestRepo = createRetrievalRequestRepo(db);
        const retrievalRepo = createRetrievalRepo(db);
        const [row] = await retrievalRepo.findByFileIds([file.id]);
        await retrievalRepo.updateStatus(row.id, 'ready', readyNow());

        expect(await requestRepo.findReadiness(requestId)).toEqual({
            totalFiles: 1,
            readyFiles: 1,
            isReady: true,
        });

        // Same rule the active-retrieval predicate uses: `ready` past its
        // window is not downloadable, so the request is not ready either.
        await retrievalRepo.updateStatus(row.id, 'ready', {
            expiresAt: past(),
        });

        expect(await requestRepo.findReadiness(requestId)).toEqual({
            totalFiles: 1,
            readyFiles: 0,
            isReady: false,
        });
    });

    it('getRequestStatus hides another user’s request behind NotFound', async ({
        db,
        user,
        createUser,
    }) => {
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const someoneElse = await createUser();

        await expect(
            retrievalService.getRequestStatus(db, someoneElse.id, request.id)
        ).rejects.toThrow(NotFoundError);
    });
});

describe.concurrent('retrieval artifacts (#422)', () => {
    it('a request holds positioned artifacts, one per chunk', async ({
        db,
        user,
    }) => {
        const request = await insertRetrievalRequest(db, { userId: user.id });

        await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 0,
        });
        const built = await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 1,
            status: 'ready',
            s3Key: `${user.id}/${request.id}/1.zip`,
            sizeBytes: 4 * 1024 ** 3,
        });

        // A chunk sits at the 4 GB cap, past what a 32-bit int holds: the
        // column reads back as a number, not the string a bigint otherwise
        // arrives as.
        expect(built.sizeBytes).toBe(4 * 1024 ** 3);

        // Position is unique per request: re-running a partition after a crash
        // mid-enqueue must not produce a second chunk 0.
        await expect(
            insertRetrievalArtifact(db, {
                requestId: request.id,
                position: 0,
            })
        ).rejects.toThrow();
    });
});

// The RestoreObject fan-out itself lives in the worker now (#423); what stays
// here is the database half of #329's contract — a failed row is outside the
// active unique index, so the file can be asked for again.
describe.concurrent('a failed restore releases the file (#329)', () => {
    it('lets a retry insert a fresh row after the worker marks one failed', async ({
        db,
        user,
    }) => {
        const file = await insertFile(db, { userId: user.id });
        const repo = createRetrievalRepo(db);

        await retrievalService.requestRetrieval(db, user.id, file.id, 'bulk');
        const [original] = await repo.findByFileIds([file.id]);

        // What the initiate-restore handler writes when AWS rejects the call.
        await repo.updateStatus(original.id, 'failed', {
            failedAt: new Date(),
            errorMessage: 'AWS throttled',
        });
        expect(await repo.findByFileIds([file.id])).toEqual([]);

        const retry = await retrievalService.requestRetrieval(
            db,
            user.id,
            file.id,
            'bulk'
        );
        const [fresh] = await repo.findByFileIds([file.id]);
        expect(fresh.id).not.toBe(original.id);
        expect(fresh.status).toBe('pending');

        // The retry is its own request, and its item points at the new row.
        const requestRepo = createRetrievalRequestRepo(db);
        expect(await requestRepo.findReadiness(retry.requestId)).toMatchObject({
            totalFiles: 1,
            readyFiles: 0,
        });
    });
});

// The completion predicate and the delivery scan are SQL conjuncts — the
// vacuity hazard (a zero-artifact NOT EXISTS reading as "all artifacts ready")
// and the single-winner RETURNING only mean anything against a real database.
describe.concurrent(
    'unified completion writer and direct-delivery scan (#437)',
    () => {
        /** One request via the real request path: request + item + pending row. */
        async function singleFileRequest(
            db: DB,
            userId: string,
            name: string,
            size = 1024
        ) {
            const file = await insertFile(db, { userId, name, size });
            const { requestId } = await retrievalService.requestRetrieval(
                db,
                userId,
                file.id
            );
            const [retrieval] = await createRetrievalRepo(db).findByFileIds([
                file.id,
            ]);
            return { file, requestId, retrievalId: retrieval.id };
        }

        // The reason completeIfArtifactsReady could not be reused: at zero
        // artifacts its NOT EXISTS was vacuously true, so it would have completed
        // a single-file request the moment it was created — before the thaw.
        it('never completes a single-file request while its item is pending', async ({
            db,
            user,
        }) => {
            const { requestId, retrievalId } = await singleFileRequest(
                db,
                user.id,
                'cold.cr2'
            );
            await backdateRetrievalRequest(db, requestId, BEFORE_ANY_REAL_ROW);
            const requestRepo = createRetrievalRequestRepo(db);
            const scannedIds = async () =>
                (await requestRepo.findDirectDeliverable(100)).map(
                    (r) => r.requestId
                );

            expect(await requestRepo.completeIfDeliverable(requestId)).toBe(
                undefined
            );
            expect((await requestRepo.findById(requestId))?.completedAt).toBe(
                null
            );

            // The same statement completes it once the item is downloadable.
            await createRetrievalRepo(db).updateStatus(
                retrievalId,
                'ready',
                readyNow()
            );
            // The control for the `not.toContain` below: deliverable and not yet
            // completed, the scan does return it.
            expect(await scannedIds()).toContain(requestId);
            const completed =
                await requestRepo.completeIfDeliverable(requestId);
            expect(completed?.completedAt).toBeInstanceOf(Date);

            // And a completed request leaves the scan for good — a second poll
            // run finds nothing to announce.
            expect(await scannedIds()).not.toContain(requestId);
        });

        it('two concurrent completion attempts yield exactly one winner', async ({
            db,
            user,
        }) => {
            const { requestId, retrievalId } = await singleFileRequest(
                db,
                user.id,
                'race.cr2'
            );
            await createRetrievalRepo(db).updateStatus(
                retrievalId,
                'ready',
                readyNow()
            );

            const requestRepo = createRetrievalRequestRepo(db);
            const results = await Promise.all([
                requestRepo.completeIfDeliverable(requestId),
                requestRepo.completeIfDeliverable(requestId),
            ]);

            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('the scan returns exactly the deliverable single-file requests', async ({
            db,
            user,
        }) => {
            const retrievalRepo = createRetrievalRepo(db);
            const requestRepo = createRetrievalRequestRepo(db);

            const [deliverable, stillPending, lapsed, zipA, zipB] =
                await Promise.all([
                    singleFileRequest(db, user.id, 'warm.cr2', 2_000_000),
                    singleFileRequest(db, user.id, 'pending.cr2'),
                    singleFileRequest(db, user.id, 'lapsed.cr2'),
                    insertFile(db, { userId: user.id }),
                    insertFile(db, { userId: user.id }),
                ]);
            await retrievalRepo.updateStatus(
                deliverable.retrievalId,
                'ready',
                readyNow()
            );
            await retrievalRepo.updateStatus(lapsed.retrievalId, 'ready', {
                readyAt: past(),
                expiresAt: past(),
            });

            // Two files, both thawed: zip-delivered, never the scan's to return.
            const zipRequest = await retrievalService.requestBulkRetrieval(
                db,
                user.id,
                [zipA.id, zipB.id],
                'bulk'
            );
            for (const row of await retrievalRepo.findByFileIds([
                zipA.id,
                zipB.id,
            ])) {
                await retrievalRepo.updateStatus(row.id, 'ready', readyNow());
            }

            // Scoped to this test's rows: the scan is global, and other writers
            // on a shared database leave their own requests in it. Backdated so
            // all four sit inside the limit, which is what makes the three
            // exclusions mean anything.
            const ownIds = new Set([
                deliverable.requestId,
                stillPending.requestId,
                lapsed.requestId,
                zipRequest.requestId,
            ]);
            for (const id of ownIds) {
                await backdateRetrievalRequest(db, id, BEFORE_ANY_REAL_ROW);
            }
            const scanned = (
                await requestRepo.findDirectDeliverable(100)
            ).filter((r) => ownIds.has(r.requestId));

            expect(scanned).toEqual([
                {
                    requestId: deliverable.requestId,
                    userId: user.id,
                    fileId: deliverable.file.id,
                    fileName: 'warm.cr2',
                    fileSize: 2_000_000,
                    expiresAt: expect.any(Date),
                    initiatedAt: expect.any(Date),
                    readyAt: expect.any(Date),
                },
            ]);
        });

        // The intended behavior change for zips: completion now asserts the thawed
        // originals are still live, so a build that outlasted its own restore
        // window leaves the request incomplete rather than announcing a download
        // whose source is gone.
        it('does not complete a zip request whose originals lapsed mid-build', async ({
            db,
            user,
        }) => {
            const retrievalRepo = createRetrievalRepo(db);
            const requestRepo = createRetrievalRequestRepo(db);

            async function builtZipRequest(expiresAt: Date) {
                const [a, b] = await Promise.all([
                    insertFile(db, { userId: user.id }),
                    insertFile(db, { userId: user.id }),
                ]);
                const { requestId } =
                    await retrievalService.requestBulkRetrieval(
                        db,
                        user.id,
                        [a.id, b.id],
                        'bulk'
                    );
                for (const row of await retrievalRepo.findByFileIds([
                    a.id,
                    b.id,
                ])) {
                    await retrievalRepo.updateStatus(row.id, 'ready', {
                        readyAt: past(),
                        expiresAt,
                    });
                }
                await insertRetrievalArtifact(db, {
                    requestId,
                    position: 0,
                    status: 'ready',
                    s3Key: `${user.id}/${requestId}/0.zip`,
                });
                return requestId;
            }

            const [lapsedRequest, liveRequest] = await Promise.all([
                builtZipRequest(past()),
                builtZipRequest(future()),
            ]);

            expect(await requestRepo.completeIfDeliverable(lapsedRequest)).toBe(
                undefined
            );
            // The control: identical request, unexpired originals — the artifact
            // conjunct alone is not what blocked the lapsed one.
            expect(
                (await requestRepo.completeIfDeliverable(liveRequest))
                    ?.completedAt
            ).toBeInstanceOf(Date);
        });
    }
);

// The horizon is a WHERE clause, so it only means anything against real SQL.
describe.concurrent('tier-aware poll horizon (#423)', () => {
    const HORIZONS: RestoreHorizons = {
        expedited: 0,
        standard: 6 * HOUR_MS,
        bulk: 24 * HOUR_MS,
    };
    const agoHours = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

    it('returns only rows past their own tier’s horizon', async ({
        db,
        user,
    }) => {
        const [freshBulk, dueBulk, freshStandard, dueStandard, noAcceptTime] =
            await Promise.all([
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
            ]);

        // Backdated so all five sit inside the scan's limit, which is what
        // makes the two exclusions mean anything.
        const insertPending = (
            overrides: Pick<Retrieval, 'fileId' | 'tier' | 'initiatedAt'>
        ) =>
            insertRetrieval(db, {
                userId: user.id,
                status: 'pending',
                createdAt: BEFORE_ANY_REAL_ROW,
                ...overrides,
            });

        const rows = await Promise.all([
            // 8h into a Bulk restore: nothing can have happened yet.
            insertPending({
                fileId: freshBulk.id,
                tier: 'bulk',
                initiatedAt: agoHours(8),
            }),
            insertPending({
                fileId: dueBulk.id,
                tier: 'bulk',
                initiatedAt: agoHours(30),
            }),
            // 8h is inside Bulk's horizon but past Standard's.
            insertPending({
                fileId: freshStandard.id,
                tier: 'standard',
                initiatedAt: agoHours(2),
            }),
            insertPending({
                fileId: dueStandard.id,
                tier: 'standard',
                initiatedAt: agoHours(8),
            }),
            // No accept time recorded: asked about now rather than never.
            insertPending({
                fileId: noAcceptTime.id,
                tier: 'bulk',
                initiatedAt: null,
            }),
        ]);
        const [, dueBulkRow, , dueStandardRow, noAcceptTimeRow] = rows;

        // Scoped to this test's rows: the work list is global, and other
        // writers on a shared database leave pending rows in it.
        const ownIds = new Set(rows.map((r) => r.id));
        const due = await createRetrievalRepo(db).findPendingWithFiles(
            1000,
            HORIZONS
        );
        const dueIds = new Set(
            due.map((r) => r.id).filter((id) => ownIds.has(id))
        );

        expect(dueIds).toEqual(
            new Set([dueBulkRow.id, dueStandardRow.id, noAcceptTimeRow.id])
        );
    });
});
