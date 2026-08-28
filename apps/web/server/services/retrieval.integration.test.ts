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

// The database is real; only AWS is faked, so the restore-failure test below
// exercises the actual unique index and status columns.
const s3Mocks = vi.hoisted(() => ({
    restore: vi.fn(),
    presignedGet: vi.fn(),
    // Objects default to archived — the case that needs a restore. Tests
    // about warm objects override this per-test.
    getObjectState: vi.fn(
        async (): Promise<ObjectState> => ({ availability: 'archived' })
    ),
}));

vi.mock('@/lib/storage', () => ({
    s3: {
        glacier: {
            restore: s3Mocks.restore,
            getObjectState: s3Mocks.getObjectState,
        },
        presigned: { get: s3Mocks.presignedGet },
    },
}));

import { retrievalService } from './retrieval';
import type { ObjectState } from '@nexus/db/objectState';

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

// A test that dies between installing a throwing restore mock and its inline
// reset would leak the throw (and its call count) into every later test.
afterEach(() => {
    s3Mocks.restore.mockReset();
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

        // The restored copy lapsed but the object is still warm, so the
        // fresh request should observe that and go straight to `ready`.
        s3Mocks.getObjectState.mockResolvedValueOnce({ availability: 'warm' });

        const {
            started: [retrieval],
        } = await retrievalService.requestRetrieval(db, userId, file.id);

        // Fresh row, ready immediately — the object was observed readable
        expect(retrieval.id).not.toBe(lapsed.id);
        expect(retrieval.status).toBe('ready');
        expect(retrieval.expiresAt!.getTime()).toBeGreaterThan(Date.now());

        // The insert path flipped the lapsed row to `expired` — it has to,
        // or the row would still hold the unique-index slot for the file.
        const rows = await createRetrievalRepo(db).findByUser(userId);
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

        // Whichever call lost the insert race got the winner's row back.
        expect(first.started[0].id).toBe(second.started[0].id);

        const active = await createRetrievalRepo(db).findByFileIds([file.id]);
        expect(active).toHaveLength(1);
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

        const { requestId, started } =
            await retrievalService.requestBulkRetrieval(
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
            started.map((r) => [r.fileId, r.id])
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
        s3Mocks.getObjectState.mockResolvedValueOnce({ availability: 'warm' });

        const { requestId } = await retrievalService.requestRetrieval(
            db,
            userId,
            file.id
        );

        const requestRepo = createRetrievalRequestRepo(db);
        expect(await requestRepo.findReadiness(requestId)).toEqual({
            totalFiles: 1,
            readyFiles: 1,
            isReady: true,
        });

        // Same rule the active-retrieval predicate uses: `ready` past its
        // window is not downloadable, so the request is not ready either.
        const retrievalRepo = createRetrievalRepo(db);
        const [row] = await retrievalRepo.findByFileIds([file.id]);
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

describe('partial S3 restore failure (#329)', () => {
    it('records every file first, then fails only the file AWS rejected', async () => {
        const [restored, rejected] = await Promise.all([
            insertFile(db, { userId }),
            insertFile(db, { userId }),
        ]);
        s3Mocks.restore.mockImplementation(async (key: string) => {
            if (key === rejected.s3Key) throw new Error('AWS throttled');
        });

        const result = await retrievalService.requestBulkRetrieval(
            db,
            userId,
            [restored.id, rejected.id],
            'bulk'
        );

        // The batch resolves rather than throwing, and the split names the
        // outcome: the succeeded restore is real and paid for, so its row
        // has to survive the sibling's failure.
        expect(result.started.map((r) => r.fileId)).toEqual([restored.id]);
        expect(result.started[0].status).toBe('pending');
        expect(result.failed.map((r) => r.fileId)).toEqual([rejected.id]);
        const [failedRow] = result.failed;
        expect(failedRow.status).toBe('failed');
        expect(failedRow.failedAt).toBeInstanceOf(Date);
        // Raw AWS error text (ARNs, account ids) is for operators: it lands
        // in the DB but is stripped from the mutation payload.
        expect(failedRow.errorMessage).toBeNull();

        // One RestoreObject per file, and no restore fired for a file that
        // ended up without a row.
        expect(s3Mocks.restore).toHaveBeenCalledTimes(2);

        const repo = createRetrievalRepo(db);
        const persisted = await repo.findByUser(userId);
        const persistedById = new Map(persisted.map((r) => [r.id, r]));
        expect(persistedById.get(result.started[0].id)?.status).toBe('pending');
        const persistedFailed = persistedById.get(failedRow.id);
        expect(persistedFailed?.status).toBe('failed');
        expect(persistedFailed?.errorMessage).toBe('AWS throttled');

        // `failed` sits outside the active partial unique index, so the row
        // no longer holds the file's slot and a retry inserts cleanly.
        const stillActive = await repo.findByFileIds([
            restored.id,
            rejected.id,
        ]);
        expect(stillActive.map((r) => r.fileId)).toEqual([restored.id]);

        s3Mocks.restore.mockImplementation(async () => {});
        const retry = await retrievalService.requestRetrieval(
            db,
            userId,
            rejected.id,
            'bulk'
        );
        expect(retry.failed).toEqual([]);
        expect(retry.started[0].id).not.toBe(failedRow.id);
        expect(retry.started[0].status).toBe('pending');
    });
});
