import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
    afterEach,
    vi,
} from 'vitest';
import {
    createDb,
    insertUser,
    insertFile,
    insertRetrieval,
    insertRetrievalRequest,
    insertRetrievalArtifact,
    deleteUserData,
    type Connection,
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
import type { RestoreHorizons } from '@nexus/db/repo/retrievals';

// Exercises the active-retrieval predicate against a real database: `ready`
// rows past `expiresAt` are expired by query, not by stored status — nothing
// tells us when a restored copy lapses. Also exercises
// the partial unique index guaranteeing one active retrieval per file (#266).

const db: Connection = createDb(process.env.DATABASE_URL!);

const HOUR_MS = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR_MS);
const future = () => new Date(Date.now() + HOUR_MS);

let userId: string;

beforeAll(async () => {
    const user = await insertUser(db);
    userId = user.id;
});

afterAll(async () => {
    await deleteUserData(db, userId);
});

// A test that leaves a rejecting publish installed would fail every later
// request path, which enqueues one.
afterEach(() => {
    jobMocks.publish.mockReset();
});

describe('active-retrieval expiry predicate', () => {
    it('a lapsed ready retrieval no longer blocks a fresh request', async () => {
        const file = await insertFile(db, { userId });
        const lapsed = await insertRetrieval(db, {
            userId,
            fileId: file.id,
            status: 'ready',
            readyAt: past(),
            expiresAt: past(),
        });

        await retrievalService.requestRetrieval(db, userId, file.id);

        const repo = createRetrievalRepo(db);
        // Fresh row, waiting on the initiation job — the request path writes
        // rows and asks S3 nothing (#423).
        const [retrieval] = await repo.findByFileIds([file.id]);
        expect(retrieval.id).not.toBe(lapsed.id);
        expect(retrieval.status).toBe('pending');
        expect(retrieval.initiatedAt).toBeInstanceOf(Date);

        // The insert path flipped the lapsed row to `expired` — it has to,
        // or the row would still hold the unique-index slot for the file.
        const rows = await repo.findByUser(userId);
        expect(rows.find((r) => r.id === lapsed.id)?.status).toBe('expired');
    });

    it('getDownloadUrl rejects a lapsed ready retrieval', async () => {
        const file = await insertFile(db, { userId });
        await insertRetrieval(db, {
            userId,
            fileId: file.id,
            status: 'ready',
            readyAt: past(),
            expiresAt: past(),
        });

        await expect(
            retrievalService.getDownloadUrl(db, userId, file.id)
        ).rejects.toThrow(InvalidStateError);
    });

    it('active queries exclude lapsed rows but keep unexpired, event-less, and in-flight ones', async () => {
        const repo = createRetrievalRepo(db);
        const [lapsedFile, unexpiredFile, noExpiryFile, pendingFile] =
            await Promise.all([
                insertFile(db, { userId }),
                insertFile(db, { userId }),
                insertFile(db, { userId }),
                insertFile(db, { userId }),
            ]);

        await insertRetrieval(db, {
            userId,
            fileId: lapsedFile.id,
            status: 'ready',
            expiresAt: past(),
        });
        const unexpired = await insertRetrieval(db, {
            userId,
            fileId: unexpiredFile.id,
            status: 'ready',
            expiresAt: future(),
        });
        // No expiresAt (e.g. a malformed restore-completed event): treated as
        // still active — better a stale entry than a download cut off early.
        const noExpiry = await insertRetrieval(db, {
            userId,
            fileId: noExpiryFile.id,
            status: 'ready',
            expiresAt: null,
        });
        const pending = await insertRetrieval(db, {
            userId,
            fileId: pendingFile.id,
            status: 'pending',
        });

        const fileIds = [
            lapsedFile.id,
            unexpiredFile.id,
            noExpiryFile.id,
            pendingFile.id,
        ];
        const byFileIds = await repo.findByFileIds(fileIds);
        expect(new Set(byFileIds.map((r) => r.id))).toEqual(
            new Set([unexpired.id, noExpiry.id, pending.id])
        );

        expect(await repo.findByFileId(lapsedFile.id)).toBeUndefined();

        const active = await repo.findActiveByUserWithFiles(userId);
        const activeForTheseFiles = active.filter((r) =>
            fileIds.includes(r.fileId)
        );
        expect(new Set(activeForTheseFiles.map((r) => r.id))).toEqual(
            new Set([unexpired.id, noExpiry.id, pending.id])
        );
    });
});

describe('one active retrieval per file (#266)', () => {
    it('two concurrent retrieval requests yield exactly one active row', async () => {
        const file = await insertFile(db, { userId });

        const [first, second] = await Promise.all([
            retrievalService.requestRetrieval(db, userId, file.id),
            retrievalService.requestRetrieval(db, userId, file.id),
        ]);

        expect(first.requestId).not.toBe(second.requestId);
        const active = await createRetrievalRepo(db).findByFileIds([file.id]);
        expect(active).toHaveLength(1);

        // Whichever call lost the insert race adopted the winner's row, so
        // both requests still count the file they asked for.
        const requestRepo = createRetrievalRequestRepo(db);
        expect(
            (await requestRepo.findReadiness(first.requestId)).totalFiles
        ).toBe(1);
        expect(
            (await requestRepo.findReadiness(second.requestId)).totalFiles
        ).toBe(1);
    });

    it('the unique index skips a duplicate active insert and keeps the existing row', async () => {
        const repo = createRetrievalRepo(db);
        const file = await insertFile(db, { userId });
        const winner = await insertRetrieval(db, {
            userId,
            fileId: file.id,
            status: 'pending',
        });

        const skipped = await repo.insertMany([
            {
                id: crypto.randomUUID(),
                fileId: file.id,
                userId,
                tier: 'standard',
                status: 'pending',
            },
        ]);

        expect(skipped).toEqual([]);
        const active = await repo.findByFileIds([file.id]);
        expect(active.map((r) => r.id)).toEqual([winner.id]);
    });
});

// Request-level readiness against real SQL. The unit tests can only pin the
// all-or-nothing rule on top of a mocked aggregate; the counting itself — and
// the adoption case that made a join table necessary — needs the database.
describe('a restore is one request (#422)', () => {
    const readyNow = () => ({ readyAt: new Date(), expiresAt: future() });

    it('counts every requested file and only flips ready on the last one', async () => {
        const [first, second] = await Promise.all([
            insertFile(db, { userId }),
            insertFile(db, { userId }),
        ]);

        const { requestId } = await retrievalService.requestBulkRetrieval(
            db,
            userId,
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

    it('two overlapping requests share one retrieval row and both count it', async () => {
        const [shared, onlyFirst, onlySecond] = await Promise.all([
            insertFile(db, { userId }),
            insertFile(db, { userId }),
            insertFile(db, { userId }),
        ]);

        const first = await retrievalService.requestBulkRetrieval(
            db,
            userId,
            [shared.id, onlyFirst.id],
            'bulk'
        );
        const second = await retrievalService.requestBulkRetrieval(
            db,
            userId,
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

    it('a lapsed ready retrieval stops counting toward its request', async () => {
        const file = await insertFile(db, { userId });

        const { requestId } = await retrievalService.requestRetrieval(
            db,
            userId,
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

    it('getRequestStatus hides another user’s request behind NotFound', async () => {
        const request = await insertRetrievalRequest(db, { userId });

        await expect(
            retrievalService.getRequestStatus(db, 'someone-else', request.id)
        ).rejects.toThrow(NotFoundError);
    });
});

describe('retrieval artifacts (#422)', () => {
    it('a request holds positioned artifacts, one per chunk', async () => {
        const request = await insertRetrievalRequest(db, { userId });

        await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 0,
        });
        const built = await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 1,
            status: 'ready',
            s3Key: `${userId}/${request.id}/1.zip`,
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
describe('a failed restore releases the file (#329)', () => {
    it('lets a retry insert a fresh row after the worker marks one failed', async () => {
        const file = await insertFile(db, { userId });
        const repo = createRetrievalRepo(db);

        await retrievalService.requestRetrieval(db, userId, file.id, 'bulk');
        const [original] = await repo.findByFileIds([file.id]);

        // What the initiate-restore handler writes when AWS rejects the call.
        await repo.updateStatus(original.id, 'failed', {
            failedAt: new Date(),
            errorMessage: 'AWS throttled',
        });
        expect(await repo.findByFileIds([file.id])).toEqual([]);

        const retry = await retrievalService.requestRetrieval(
            db,
            userId,
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

// The horizon is a WHERE clause, so it only means anything against real SQL.
describe('tier-aware poll horizon (#423)', () => {
    const HORIZONS: RestoreHorizons = {
        expedited: 0,
        standard: 6 * HOUR_MS,
        bulk: 24 * HOUR_MS,
    };
    const agoHours = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

    it('returns only rows past their own tier’s horizon', async () => {
        const [freshBulk, dueBulk, freshStandard, dueStandard, noAcceptTime] =
            await Promise.all([
                insertFile(db, { userId }),
                insertFile(db, { userId }),
                insertFile(db, { userId }),
                insertFile(db, { userId }),
                insertFile(db, { userId }),
            ]);

        const rows = await Promise.all([
            // 8h into a Bulk restore: nothing can have happened yet.
            insertRetrieval(db, {
                userId,
                fileId: freshBulk.id,
                status: 'pending',
                tier: 'bulk',
                initiatedAt: agoHours(8),
            }),
            insertRetrieval(db, {
                userId,
                fileId: dueBulk.id,
                status: 'pending',
                tier: 'bulk',
                initiatedAt: agoHours(30),
            }),
            // 8h is inside Bulk's horizon but past Standard's.
            insertRetrieval(db, {
                userId,
                fileId: freshStandard.id,
                status: 'pending',
                tier: 'standard',
                initiatedAt: agoHours(2),
            }),
            insertRetrieval(db, {
                userId,
                fileId: dueStandard.id,
                status: 'pending',
                tier: 'standard',
                initiatedAt: agoHours(8),
            }),
            // No accept time recorded: asked about now rather than never.
            insertRetrieval(db, {
                userId,
                fileId: noAcceptTime.id,
                status: 'pending',
                tier: 'bulk',
                initiatedAt: null,
            }),
        ]);
        const [, dueBulkRow, , dueStandardRow, noAcceptTimeRow] = rows;

        // Scoped to this test's rows: the work list is global, and every other
        // test in this file leaves pending rows behind (all of them freshly
        // initiated, hence inside their horizon — which is the point).
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
