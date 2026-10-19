import { vi } from 'vitest';
import { it, expect, describe, afterEach } from '../test-db/integration';
import { artifactWindowStart } from '../objectState';
import {
    insertFile,
    insertRetrieval,
    insertRetrievalArtifact,
    insertRetrievalRequest,
    insertRetrievalRequestItem,
    type DB,
    type Retrieval,
    type RetrievalRequest,
} from '../test-db';
import { createRetrievalRequestRepo } from './retrievalRequests';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

// `findBuildable` and `findDirectDeliverable` scan every user's requests,
// oldest first, under a LIMIT, and the dev database is shared. Requests
// created before any real row sort first and stay inside the limit, so the
// exclusions below mean something (#491). Earlier than the web tier's
// 2000-01-01 so the two files' rows never compete for the same slots.
const BEFORE_ANY_REAL_ROW = new Date('1990-01-01T00:00:00Z');
const SCAN_LIMIT = 100;

/** A retrieval row's state for one item; `null` is an item whose restore failed before any row existed. */
type ItemState = Partial<Retrieval> | null;
/** `insertRetrieval`'s default: ready, with an open download window. */
const READY: ItemState = {};
/** Ready, but its download window has closed: the copy is back in Glacier. */
const LAPSED: ItemState = { expiresAt: hoursAgo(1) };
const PENDING: ItemState = { status: 'pending' };
const NO_RETRIEVAL: ItemState = null;

async function seedItem(db: DB, request: RetrievalRequest, state: ItemState) {
    const file = await insertFile(db, { userId: request.userId });
    const retrieval =
        state === null
            ? null
            : await insertRetrieval(db, {
                  userId: request.userId,
                  fileId: file.id,
                  ...state,
              });
    const item = await insertRetrievalRequestItem(db, {
        requestId: request.id,
        fileId: file.id,
        retrievalId: retrieval?.id ?? null,
    });
    return { file, retrieval, item };
}

async function seedRequest(
    db: DB,
    userId: string,
    items: ItemState[],
    overrides: Partial<RetrievalRequest> = {}
) {
    const request = await insertRetrievalRequest(db, { userId, ...overrides });
    const seeded = await Promise.all(
        items.map((state) => seedItem(db, request, state))
    );
    return { request, items: seeded };
}

describe.concurrent('request lookups', () => {
    it('insert and findById round-trip, and an unknown id finds nothing', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const id = crypto.randomUUID();

        await repo.insert({ id, userId: user.id, tier: 'bulk' });

        expect(await repo.findById(id)).toMatchObject({
            id,
            userId: user.id,
            tier: 'bulk',
            completedAt: null,
        });
        expect(await repo.findById(crypto.randomUUID())).toBeUndefined();
    });

    it('findByUserAndId returns the request to its owner, by its id only', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });

        expect((await repo.findByUserAndId(user.id, request.id))?.id).toBe(
            request.id
        );
        // The owner has a request, so a dropped id term would return it.
        expect(
            await repo.findByUserAndId(user.id, crypto.randomUUID())
        ).toBeUndefined();
    });

    it('findByUserAndId does not return another user’s request, even by its id', async ({
        db,
        user,
        createUser,
    }) => {
        const owner = await createUser();
        const request = await insertRetrievalRequest(db, { userId: owner.id });

        const found = await createRetrievalRequestRepo(db).findByUserAndId(
            user.id,
            request.id
        );

        expect(found).toBeUndefined();
    });

    it('insertItems writes nothing, and does not throw, for an empty list', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });

        await repo.insertItems([]);

        expect((await repo.findReadiness(request.id)).totalFiles).toBe(0);
    });
});

describe.concurrent('findPendingRetrievals', () => {
    it('returns the request’s pending rows oldest first, and no other request’s', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const {
            request,
            items: [newer, older],
        } = await seedRequest(db, user.id, [
            { status: 'pending', createdAt: hoursAgo(1), restoreDaysToKeep: 1 },
            { status: 'pending', createdAt: hoursAgo(2) },
            READY,
            NO_RETRIEVAL,
        ]);
        await seedRequest(db, user.id, [PENDING]);

        expect(await repo.findPendingRetrievals(request.id)).toEqual([
            {
                retrievalId: older.retrieval!.id,
                fileId: older.file.id,
                s3Key: older.file.s3Key,
                restoreDaysToKeep: null,
            },
            {
                retrievalId: newer.retrieval!.id,
                fileId: newer.file.id,
                s3Key: newer.file.s3Key,
                restoreDaysToKeep: 1,
            },
        ]);
    });
});

describe.concurrent('findReadiness', () => {
    // All-or-nothing (#406): an empty request has nothing to download, so
    // `0 === 0` must not read as ready.
    it('an empty request is not ready', async ({ db, user }) => {
        const request = await insertRetrievalRequest(db, { userId: user.id });

        expect(
            await createRetrievalRequestRepo(db).findReadiness(request.id)
        ).toEqual({ totalFiles: 0, readyFiles: 0, isReady: false });
    });

    it('counts only the request’s own items, a missing retrieval as not ready', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const { request } = await seedRequest(db, user.id, [
            READY,
            PENDING,
            NO_RETRIEVAL,
        ]);
        await seedRequest(db, user.id, [READY, READY]);

        expect(await repo.findReadiness(request.id)).toEqual({
            totalFiles: 3,
            readyFiles: 1,
            isReady: false,
        });
    });

    it('is ready once every item is', async ({ db, user }) => {
        const { request } = await seedRequest(db, user.id, [READY, READY]);

        expect(
            await createRetrievalRequestRepo(db).findReadiness(request.id)
        ).toEqual({ totalFiles: 2, readyFiles: 2, isReady: true });
    });
});

describe.concurrent('worker scans', () => {
    it('findBuildable returns unfinished multi-file requests whose every item is ready', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const seed = (
            userId: string,
            items: ItemState[],
            overrides: Partial<RetrievalRequest> = {}
        ) =>
            seedRequest(db, userId, items, {
                createdAt: BEFORE_ANY_REAL_ROW,
                ...overrides,
            });
        const [
            buildable,
            strangers,
            partial,
            lapsed,
            missing,
            single,
            completed,
        ] = await Promise.all([
            seed(user.id, [READY, READY]),
            // Every user's requests: the worker has no session to scope by.
            seed(stranger.id, [READY, READY]),
            seed(user.id, [READY, PENDING]),
            // Status `ready` alone isn't enough: the zip would read objects
            // that are back in Glacier.
            seed(user.id, [READY, LAPSED]),
            // The null join `is not true` exists for: a plain `not` reads
            // it as ready.
            seed(user.id, [READY, NO_RETRIEVAL]),
            // Below ZIP_DELIVERY_MIN_FILES: delivered directly, never zipped.
            seed(user.id, [READY]),
            seed(user.id, [READY, READY], { completedAt: new Date() }),
        ]);
        const ownIds = new Set(
            [
                buildable,
                strangers,
                partial,
                lapsed,
                missing,
                single,
                completed,
            ].map((seeded) => seeded.request.id)
        );

        const scanned = (
            await createRetrievalRequestRepo(db).findBuildable(SCAN_LIMIT)
        ).filter((id) => ownIds.has(id));

        expect(new Set(scanned)).toEqual(
            new Set([buildable.request.id, strangers.request.id])
        );
    });

    it('findBuildable returns the oldest request first', async ({
        db,
        user,
    }) => {
        const [newer, older] = await Promise.all([
            seedRequest(db, user.id, [READY, READY], {
                createdAt: new Date(BEFORE_ANY_REAL_ROW.getTime() + DAY_MS),
            }),
            seedRequest(db, user.id, [READY, READY], {
                createdAt: BEFORE_ANY_REAL_ROW,
            }),
        ]);
        const ownIds = new Set([newer.request.id, older.request.id]);

        const scanned = (
            await createRetrievalRequestRepo(db).findBuildable(SCAN_LIMIT)
        ).filter((id) => ownIds.has(id));

        expect(scanned).toEqual([older.request.id, newer.request.id]);
    });

    // One poll run's budget: past it, the rest wait for the next run.
    it('findBuildable returns at most `limit` requests', async ({
        db,
        user,
    }) => {
        await Promise.all([
            seedRequest(db, user.id, [READY, READY]),
            seedRequest(db, user.id, [READY, READY]),
        ]);

        const scanned = await createRetrievalRequestRepo(db).findBuildable(1);

        expect(scanned).toHaveLength(1);
    });

    it('findDirectDeliverable returns unfinished single-file requests whose file is ready', async ({
        db,
        user,
    }) => {
        const seed = (
            items: ItemState[],
            overrides: Partial<RetrievalRequest> = {}
        ) =>
            seedRequest(db, user.id, items, {
                createdAt: BEFORE_ANY_REAL_ROW,
                ...overrides,
            });
        const [deliverable, pending, missing, zip, completed] =
            await Promise.all([
                seed([READY]),
                seed([PENDING]),
                seed([NO_RETRIEVAL]),
                // At ZIP_DELIVERY_MIN_FILES: findBuildable's, not this scan's.
                seed([READY, READY]),
                seed([READY], { completedAt: new Date() }),
            ]);
        const ownIds = new Set(
            [deliverable, pending, missing, zip, completed].map(
                (seeded) => seeded.request.id
            )
        );

        const scanned = (
            await createRetrievalRequestRepo(db).findDirectDeliverable(
                SCAN_LIMIT
            )
        ).filter((row) => ownIds.has(row.requestId));

        const [{ file, retrieval }] = deliverable.items;
        expect(scanned).toEqual([
            {
                requestId: deliverable.request.id,
                userId: user.id,
                fileId: file.id,
                fileName: file.name,
                fileSize: file.size,
                expiresAt: retrieval!.expiresAt,
                initiatedAt: retrieval!.initiatedAt,
                readyAt: retrieval!.readyAt,
            },
        ]);
    });
});

describe.concurrent('files of a request', () => {
    it('findFiles returns the request’s files in s3Key order, and no other request’s', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const other = await insertRetrievalRequest(db, { userId: user.id });
        const [second, first, elsewhere] = await Promise.all([
            insertFile(db, { userId: user.id, s3Key: `${user.id}/b` }),
            insertFile(db, { userId: user.id, s3Key: `${user.id}/a` }),
            insertFile(db, { userId: user.id }),
        ]);
        await repo.insertItems(
            [second, first].map((file) => ({
                id: crypto.randomUUID(),
                requestId: request.id,
                fileId: file.id,
            }))
        );
        await insertRetrievalRequestItem(db, {
            requestId: other.id,
            fileId: elsewhere.id,
        });

        expect(await repo.findFiles(request.id)).toEqual(
            [first, second].map((file) => ({
                fileId: file.id,
                s3Key: file.s3Key,
                name: file.name,
                size: file.size,
                createdAt: file.createdAt,
            }))
        );
    });

    it('findArtifactFiles returns only that artifact’s files, in s3Key order', async ({
        db,
        user,
    }) => {
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const [a, b] = await Promise.all([
            insertRetrievalArtifact(db, { requestId: request.id, position: 0 }),
            insertRetrievalArtifact(db, { requestId: request.id, position: 1 }),
        ]);
        const [second, first, inB] = await Promise.all([
            insertFile(db, { userId: user.id, s3Key: `${user.id}/b` }),
            insertFile(db, { userId: user.id, s3Key: `${user.id}/a` }),
            insertFile(db, { userId: user.id }),
        ]);
        await Promise.all(
            [
                { fileId: second.id, artifactId: a.id },
                { fileId: first.id, artifactId: a.id },
                { fileId: inB.id, artifactId: b.id },
            ].map((item) =>
                insertRetrievalRequestItem(db, {
                    requestId: request.id,
                    ...item,
                })
            )
        );

        const files = await createRetrievalRequestRepo(db).findArtifactFiles(
            a.id
        );

        expect(files.map((f) => f.fileId)).toEqual([first.id, second.id]);
    });

    // The partition's unit is the request: the same file in an overlapping
    // request is a different item, and belongs to that request's own zip.
    it('assignItemsToArtifact points only the named files of that request at the artifact', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const [shared, unnamed] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);
        const [request, overlapping] = await Promise.all([
            insertRetrievalRequest(db, { userId: user.id }),
            insertRetrievalRequest(db, { userId: user.id }),
        ]);
        await Promise.all([
            insertRetrievalRequestItem(db, {
                requestId: request.id,
                fileId: shared.id,
            }),
            insertRetrievalRequestItem(db, {
                requestId: request.id,
                fileId: unnamed.id,
            }),
            insertRetrievalRequestItem(db, {
                requestId: overlapping.id,
                fileId: shared.id,
            }),
        ]);
        const artifact = await insertRetrievalArtifact(db, {
            requestId: request.id,
        });

        await repo.assignItemsToArtifact(request.id, artifact.id, [shared.id]);

        expect(
            (await repo.findArtifactFiles(artifact.id)).map((f) => f.fileId)
        ).toEqual([shared.id]);
    });

    it('assignItemsToArtifact with no files is a no-op', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const { request } = await seedRequest(db, user.id, [READY]);
        const artifact = await insertRetrievalArtifact(db, {
            requestId: request.id,
        });

        await repo.assignItemsToArtifact(request.id, artifact.id, []);

        expect(await repo.findArtifactFiles(artifact.id)).toEqual([]);
    });
});

describe.concurrent('artifact lookups', () => {
    it('findArtifactById returns that artifact, and nothing for an unknown id', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const artifact = await insertRetrievalArtifact(db, {
            requestId: request.id,
        });

        expect(await repo.findArtifactById(artifact.id)).toEqual(artifact);
        expect(
            await repo.findArtifactById(crypto.randomUUID())
        ).toBeUndefined();
    });

    it('findArtifactByUserAndId returns the artifact to its request’s owner, by its id only', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const artifact = await insertRetrievalArtifact(db, {
            requestId: request.id,
        });

        expect(
            await repo.findArtifactByUserAndId(user.id, artifact.id)
        ).toEqual(artifact);
        // The owner has an artifact, so a dropped id term would return it.
        expect(
            await repo.findArtifactByUserAndId(user.id, crypto.randomUUID())
        ).toBeUndefined();
    });

    // An artifact has no userId of its own: ownership comes through its
    // request, and another user's must look exactly like a missing one.
    it('findArtifactByUserAndId does not return another user’s artifact, even by its id', async ({
        db,
        user,
        createUser,
    }) => {
        const owner = await createUser();
        const request = await insertRetrievalRequest(db, { userId: owner.id });
        const artifact = await insertRetrievalArtifact(db, {
            requestId: request.id,
        });

        const found = await createRetrievalRequestRepo(
            db
        ).findArtifactByUserAndId(user.id, artifact.id);

        expect(found).toBeUndefined();
    });

    it('findArtifacts returns the request’s artifacts in part order', async ({
        db,
        user,
    }) => {
        const [request, other] = await Promise.all([
            insertRetrievalRequest(db, { userId: user.id }),
            insertRetrievalRequest(db, { userId: user.id }),
        ]);
        const second = await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 1,
        });
        const first = await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 0,
        });
        await insertRetrievalArtifact(db, { requestId: other.id, position: 0 });

        const artifacts = await createRetrievalRequestRepo(db).findArtifacts(
            request.id
        );

        expect(artifacts.map((a) => a.id)).toEqual([first.id, second.id]);
    });
});

describe.concurrent('findTimings', () => {
    it('spans the earliest initiation to the latest thaw of the request’s own items', async ({
        db,
        user,
    }) => {
        const earliest = new Date('2026-01-01T00:00:00Z');
        const latest = new Date('2026-01-01T12:00:00Z');
        const { request } = await seedRequest(db, user.id, [
            {
                initiatedAt: earliest,
                readyAt: new Date('2026-01-01T06:00:00Z'),
            },
            { initiatedAt: new Date('2026-01-01T01:00:00Z'), readyAt: latest },
            NO_RETRIEVAL,
        ]);
        // Another request's wider window must not stretch this one's.
        await seedRequest(db, user.id, [
            {
                initiatedAt: new Date('2025-12-31T00:00:00Z'),
                readyAt: new Date('2026-01-02T00:00:00Z'),
            },
        ]);

        expect(
            await createRetrievalRequestRepo(db).findTimings(request.id)
        ).toEqual({ fileCount: 3, initiatedAt: earliest, readyAt: latest });
    });

    // Every row adopted warm: no restore was ever initiated, and that is an
    // honest null, not a date.
    it('is null at both ends when no restore was initiated', async ({
        db,
        user,
    }) => {
        const { request } = await seedRequest(db, user.id, [
            { initiatedAt: null, readyAt: null },
        ]);

        expect(
            await createRetrievalRequestRepo(db).findTimings(request.id)
        ).toEqual({ fileCount: 1, initiatedAt: null, readyAt: null });
    });
});

describe.concurrent('findDownloadableByUser', () => {
    /** A completed request with one built artifact per entry of `builtHoursAgo`. */
    async function completedRequest(
        db: DB,
        userId: string,
        builtHoursAgo: number[],
        overrides: Partial<RetrievalRequest> = {}
    ) {
        const { request } = await seedRequest(db, userId, [READY, READY], {
            completedAt: new Date(),
            ...overrides,
        });
        const artifacts = await Promise.all(
            builtHoursAgo.map((hours, position) =>
                insertRetrievalArtifact(db, {
                    requestId: request.id,
                    position,
                    status: 'ready',
                    sizeBytes: 100 * (position + 1),
                    completedAt: hoursAgo(hours),
                })
            )
        );
        return { request, artifacts };
    }

    it('summarises each of the user’s completed requests, most recently built first', async ({
        db,
        user,
    }) => {
        const older = await completedRequest(db, user.id, [3, 5], {
            tier: 'bulk',
        });
        const newer = await completedRequest(db, user.id, [1]);

        const downloadable = await createRetrievalRequestRepo(
            db
        ).findDownloadableByUser(user.id);

        expect(downloadable).toEqual([
            {
                id: newer.request.id,
                tier: newer.request.tier,
                completedAt: newer.request.completedAt,
                fileCount: 2,
                partCount: 1,
                totalBytes: 100,
                builtAt: newer.artifacts[0].completedAt,
            },
            {
                id: older.request.id,
                tier: 'bulk',
                completedAt: older.request.completedAt,
                fileCount: 2,
                partCount: 2,
                totalBytes: 300,
                // The earliest part expires first, so it starts the window.
                builtAt: older.artifacts[1].completedAt,
            },
        ]);
    });

    it('leaves out unfinished, expired and other users’ requests', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [kept] = await Promise.all([
            completedRequest(db, user.id, [1]),
            // Its artifact is built but the request never completed.
            completedRequest(db, user.id, [1], { completedAt: null }),
            // Built past the retention window: S3 has already deleted it.
            completedRequest(db, user.id, [8 * 24]),
            completedRequest(db, stranger.id, [1]),
        ]);

        const downloadable = await createRetrievalRequestRepo(
            db
        ).findDownloadableByUser(user.id);

        expect(downloadable.map((row) => row.id)).toEqual([kept.request.id]);
    });

    it('narrows to one request when given its id', async ({ db, user }) => {
        const [wanted] = await Promise.all([
            completedRequest(db, user.id, [2]),
            completedRequest(db, user.id, [1]),
        ]);

        const downloadable = await createRetrievalRequestRepo(
            db
        ).findDownloadableByUser(user.id, wanted.request.id);

        expect(downloadable.map((row) => row.id)).toEqual([wanted.request.id]);
    });
});

// Sequential, because it freezes the clock: the window is measured from the
// query's own `now`, and a concurrent test would read the frozen time too.
describe('findDownloadableByUser window boundary', () => {
    afterEach(() => vi.useRealTimers());

    it('drops a request whose first part was built exactly one retention period ago', async ({
        db,
        user,
    }) => {
        vi.useFakeTimers({ toFake: ['Date'], now: new Date() });
        const windowStart = artifactWindowStart();
        // The first, built exactly at the window start, has expired.
        const [, justInside] = await Promise.all(
            [windowStart, new Date(windowStart.getTime() + 1)].map(
                async (builtAt) => {
                    const { request } = await seedRequest(
                        db,
                        user.id,
                        [READY],
                        {
                            completedAt: new Date(),
                        }
                    );
                    await insertRetrievalArtifact(db, {
                        requestId: request.id,
                        position: 0,
                        status: 'ready',
                        sizeBytes: 100,
                        completedAt: builtAt,
                    });
                    return request;
                }
            )
        );

        const downloadable = await createRetrievalRequestRepo(
            db
        ).findDownloadableByUser(user.id);

        expect(downloadable.map((row) => row.id)).toEqual([justInside.id]);
    });
});

describe.concurrent('artifact lifecycle', () => {
    it('insertArtifacts with no rows returns nothing, and does not throw', async ({
        db,
    }) => {
        expect(
            await createRetrievalRequestRepo(db).insertArtifacts([])
        ).toEqual([]);
    });

    // A poll that crashed between inserting the partition and enqueueing its
    // jobs re-runs it: the existing chunk stays as it was, the missing one goes
    // in.
    it('insertArtifacts skips a position that already exists and inserts the rest', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const existing = await insertRetrievalArtifact(db, {
            requestId: request.id,
            position: 0,
            status: 'building',
        });

        const inserted = await repo.insertArtifacts(
            [0, 1].map((position) => ({
                id: crypto.randomUUID(),
                requestId: request.id,
                position,
            }))
        );

        expect(inserted.map((a) => a.position)).toEqual([1]);
        expect(
            (await repo.findArtifacts(request.id)).map((a) => [a.id, a.status])
        ).toEqual([
            [existing.id, 'building'],
            [inserted[0].id, 'pending'],
        ]);
    });

    it('claimArtifact takes a pending or failed artifact into building and counts the attempt', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const [pending, failed, bystander] = await Promise.all(
            [
                { position: 0, status: 'pending' as const, attempts: 0 },
                { position: 1, status: 'failed' as const, attempts: 2 },
                { position: 2, status: 'pending' as const, attempts: 0 },
            ].map((overrides) =>
                insertRetrievalArtifact(db, {
                    requestId: request.id,
                    ...overrides,
                })
            )
        );

        const claimed = await Promise.all([
            repo.claimArtifact(pending.id),
            repo.claimArtifact(failed.id),
        ]);

        expect(claimed).toEqual([
            expect.objectContaining({
                id: pending.id,
                status: 'building',
                attempts: 1,
                startedAt: expect.any(Date),
            }),
            expect.objectContaining({
                id: failed.id,
                status: 'building',
                attempts: 3,
                startedAt: expect.any(Date),
            }),
        ]);
        expect(await repo.findArtifactById(bystander.id)).toEqual(bystander);
    });

    // A duplicate delivery after a successful build must be a no-op, not a
    // second 4 GB upload.
    it('claimArtifact leaves a ready artifact alone', async ({ db, user }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const ready = await insertRetrievalArtifact(db, {
            requestId: request.id,
            status: 'ready',
            attempts: 1,
        });

        expect(await repo.claimArtifact(ready.id)).toBeUndefined();
        expect(await repo.findArtifactById(ready.id)).toEqual(ready);
    });

    it('completeArtifact records the zip and clears the previous attempt’s error', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const [artifact, bystander] = await Promise.all(
            [0, 1].map((position) =>
                insertRetrievalArtifact(db, {
                    requestId: request.id,
                    position,
                    status: 'building',
                    error: 'socket hang up',
                })
            )
        );

        const completed = await repo.completeArtifact(artifact.id, {
            s3Key: 'zips/part-1.zip',
            sizeBytes: 4096,
        });

        expect(completed).toMatchObject({
            id: artifact.id,
            status: 'ready',
            s3Key: 'zips/part-1.zip',
            sizeBytes: 4096,
            completedAt: expect.any(Date),
            error: null,
        });
        expect(await repo.findArtifactById(bystander.id)).toEqual(bystander);
        expect(
            await repo.completeArtifact(crypto.randomUUID(), {
                s3Key: 'x',
                sizeBytes: 1,
            })
        ).toBeUndefined();
    });

    // Only a build in progress can fail: a late failure from an abandoned
    // attempt must not knock down a chunk that since built, or one that was
    // never claimed.
    it('failArtifact fails only that artifact, and only while it is building', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const request = await insertRetrievalRequest(db, { userId: user.id });
        const [building, ready, pending, bystander] = await Promise.all(
            (['building', 'ready', 'pending', 'building'] as const).map(
                (status, position) =>
                    insertRetrievalArtifact(db, {
                        requestId: request.id,
                        position,
                        status,
                    })
            )
        );

        await Promise.all(
            [building, ready, pending].map((a) =>
                repo.failArtifact(a.id, 'zip stream aborted')
            )
        );

        const after = await repo.findArtifacts(request.id);
        expect(after.map((a) => [a.status, a.error])).toEqual([
            ['failed', 'zip stream aborted'],
            ['ready', null],
            ['pending', null],
            ['building', null],
        ]);
        expect(after[3].id).toBe(bystander.id);
    });
});

describe.concurrent('completeIfDeliverable', () => {
    // The neighbours are what the request-scoped terms exist for: another
    // request with a pending item and one with an unbuilt artifact must neither
    // block this one nor be completed along with it.
    it('completes a request whose items and artifacts are all ready, and only that one', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRequestRepo(db);
        const [{ request }, pendingItem, unbuilt] = await Promise.all([
            seedRequest(db, user.id, [READY, READY]),
            seedRequest(db, user.id, [READY, PENDING]),
            seedRequest(db, user.id, [READY, READY]),
        ]);
        await Promise.all([
            insertRetrievalArtifact(db, {
                requestId: request.id,
                status: 'ready',
            }),
            insertRetrievalArtifact(db, {
                requestId: unbuilt.request.id,
                status: 'building',
            }),
        ]);

        const completed = await repo.completeIfDeliverable(request.id);

        expect(completed).toMatchObject({
            id: request.id,
            completedAt: expect.any(Date),
        });
        expect(
            (await repo.findById(pendingItem.request.id))?.completedAt
        ).toBeNull();
        expect(
            (await repo.findById(unbuilt.request.id))?.completedAt
        ).toBeNull();
    });

    // A single-file request never has an artifact, so the artifact half is
    // vacuously true and the thawed original is the proof.
    it('completes a single-file request once its item is ready', async ({
        db,
        user,
    }) => {
        const { request } = await seedRequest(db, user.id, [READY]);

        const completed = await createRetrievalRequestRepo(
            db
        ).completeIfDeliverable(request.id);

        expect(completed?.id).toBe(request.id);
    });

    it.for([
        ['an item is still thawing', [READY, PENDING], 'ready'],
        ['an item has no retrieval row', [READY, NO_RETRIEVAL], 'ready'],
        ['an artifact is still building', [READY, READY], 'building'],
    ] as const)(
        'does not complete a request while %s',
        async ([, items, artifactStatus], { db, user }) => {
            const repo = createRetrievalRequestRepo(db);
            const { request } = await seedRequest(db, user.id, [...items]);
            await insertRetrievalArtifact(db, {
                requestId: request.id,
                status: artifactStatus,
            });

            expect(
                await repo.completeIfDeliverable(request.id)
            ).toBeUndefined();
            expect((await repo.findById(request.id))?.completedAt).toBeNull();
        }
    );

    // The single-winner guard: the one row back is who sends the ready email.
    it('does not complete a request twice', async ({ db, user }) => {
        const repo = createRetrievalRequestRepo(db);
        const completedAt = new Date('2026-01-01T00:00:00Z');
        const { request } = await seedRequest(db, user.id, [READY], {
            completedAt,
        });

        expect(await repo.completeIfDeliverable(request.id)).toBeUndefined();
        expect((await repo.findById(request.id))?.completedAt).toEqual(
            completedAt
        );
    });
});
