import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    createDb,
    insertUser,
    insertFile,
    insertRetrieval,
    deleteUserData,
    type Connection,
} from '@nexus/db/test-db';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { InvalidStateError } from '@/server/errors';
import { retrievalService } from './retrieval';

// Exercises the active-retrieval predicate against a real database: `ready`
// rows past `expiresAt` are expired by query, not by stored status — no S3
// expiry event ever fires for standard-tier fast-path rows.

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

describe('active-retrieval expiry predicate', () => {
    it('a lapsed ready retrieval no longer blocks a fresh request', async () => {
        const file = await insertFile(db, { userId, storageTier: 'standard' });
        const lapsed = await insertRetrieval(db, {
            userId,
            fileId: file.id,
            status: 'ready',
            readyAt: past(),
            expiresAt: past(),
        });

        const retrieval = await retrievalService.requestRetrieval(
            db,
            userId,
            file.id
        );

        // Fresh row, ready immediately via the standard-tier fast path
        expect(retrieval.id).not.toBe(lapsed.id);
        expect(retrieval.status).toBe('ready');
        expect(retrieval.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('getDownloadUrl rejects a lapsed ready retrieval', async () => {
        const file = await insertFile(db, { userId, storageTier: 'standard' });
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
