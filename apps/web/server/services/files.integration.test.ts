import { vi } from 'vitest';
import { it, describe, expect, afterEach } from '@nexus/db/test-db/integration';
import { insertFile, insertStorageUsage, type DB } from '@nexus/db/test-db';

// The database is real — that's the point: this pins the atomicity of the
// `usedBytes + n` upsert in storage-usage and of the upload status claims,
// which no mock can express. Only the out-of-process effects are faked.
const s3Mocks = vi.hoisted(() => {
    // A real DeleteObject is a network round trip, and that gap is the window
    // a racing confirm used to slip through — so the fake takes one too.
    const roundTrip = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 20));
    return {
        roundTrip,
        removeObject: vi.fn(roundTrip),
        completeMultipart: vi.fn(),
        abortMultipart: vi.fn(),
    };
});

const jobMocks = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@/lib/jobs', () => ({ jobs: { publish: jobMocks.publish } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/storage', () => ({
    s3: {
        objects: { remove: s3Mocks.removeObject },
        multipart: {
            complete: s3Mocks.completeMultipart,
            abort: s3Mocks.abortMultipart,
        },
    },
}));

import { createFileRepo } from '@nexus/db/repo/files';
import { fileService } from './files';

/**
 * Uploads run several files at once (#340), so a batch's `confirmUpload` calls
 * now overlap. They all increment one `storage_usage` row, and the whole
 * no-new-accounting decision rests on that increment being a SQL-side
 * `usedBytes + n` upsert rather than a read-modify-write — a lost update here
 * would silently under-bill every concurrent upload.
 */
const CONCURRENCY = 6;
// Prime-ish, so a lost update can't happen to sum to the right number anyway.
const FILE_SIZE = 1_000_003;

afterEach(() => {
    // Reset, not clear: a test that swaps in its own implementation must not
    // leak it into the next one. Mocks built as `vi.fn(impl)` go back to impl.
    vi.resetAllMocks();
});

function seedUploadingFiles(db: DB, owner: string, count: number) {
    return Promise.all(
        Array.from({ length: count }, () =>
            insertFile(db, {
                userId: owner,
                status: 'uploading',
                size: FILE_SIZE,
            })
        )
    );
}

async function readUsage(db: DB, owner: string) {
    const usage = await db.query.storageUsage.findFirst({
        where: (u, { eq }) => eq(u.userId, owner),
    });
    return {
        usedBytes: Number(usage?.usedBytes ?? 0),
        fileCount: usage?.fileCount ?? 0,
    };
}

describe('confirmUpload under concurrency', () => {
    it('lands the same usage as serial confirms when fired concurrently', async ({
        db,
        user,
    }) => {
        await insertStorageUsage(db, {
            userId: user.id,
            usedBytes: 0,
            fileCount: 0,
        });
        const files = await seedUploadingFiles(db, user.id, CONCURRENCY);

        await Promise.all(
            files.map((file) => fileService.confirmUpload(db, user.id, file.id))
        );

        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE * CONCURRENCY,
            fileCount: CONCURRENCY,
        });
    });

    it('counts correctly when no usage row exists yet', async ({
        db,
        user,
    }) => {
        // A user's first-ever upload: every concurrent confirm takes the INSERT
        // branch of the upsert and they race on the userId unique index. A
        // fixture user starts with no usage row.
        const files = await seedUploadingFiles(db, user.id, CONCURRENCY);

        await Promise.all(
            files.map((file) => fileService.confirmUpload(db, user.id, file.id))
        );

        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE * CONCURRENCY,
            fileCount: CONCURRENCY,
        });
    });
});

/**
 * Every way out of `uploading` is a claim: the status check is part of the
 * UPDATE, so of two racing transitions exactly one gets the row back and the
 * other does nothing. Which one wins is up to the database — these assert the
 * invariant that has to hold either way.
 */
describe('upload transitions under concurrency (#381)', () => {
    const MULTIPART = {
        uploadId: 'upload-1',
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
    };

    function readFiles(db: DB, ids: string[]) {
        return db.query.files.findMany({
            where: (f, { inArray }) => inArray(f.id, ids),
        });
    }

    // The heart of the fix at its narrowest: two claims on one row with
    // opposite targets. Postgres serializes them and the loser re-checks the
    // predicate against the winner's committed row, so it matches nothing.
    it('lets exactly one of a confirm claim and a release claim win', async ({
        db,
        user,
    }) => {
        const [file] = await seedUploadingFiles(db, user.id, 1);
        const repo = createFileRepo(db);

        const claims = await Promise.all([
            repo.claimUpload(user.id, file.id, 'available'),
            repo.claimUpload(user.id, file.id, 'deleted'),
        ]);

        expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it('a cancel racing a confirm either releases the upload or counts it, never both', async ({
        db,
        user,
    }) => {
        const files = await seedUploadingFiles(db, user.id, CONCURRENCY);
        // The row's status at the moment S3 was told to delete its object.
        // Call order alone can't show the claim was committed by then; this
        // reads it back from another connection.
        const statusAtRemove = new Map<string, string | undefined>();
        s3Mocks.removeObject.mockImplementation(async (key: string) => {
            const row = await db.query.files.findFirst({
                where: (f, { eq }) => eq(f.s3Key, key),
            });
            statusAtRemove.set(key, row?.status);
            await s3Mocks.roundTrip();
        });

        await Promise.all(
            files.map((file) =>
                Promise.all([
                    fileService.confirmUpload(db, user.id, file.id),
                    fileService.abandonUpload(db, user.id, file.id),
                ])
            )
        );

        const after = await readFiles(
            db,
            files.map((f) => f.id)
        );
        for (const file of after) {
            expect(['available', 'deleted']).toContain(file.status);
        }
        // The bytes are gone exactly when the row says released (an
        // `available` file with no object is the silent loss this guards),
        // and each DeleteObject ran only once its claim had committed.
        expect(Object.fromEntries(statusAtRemove)).toEqual(
            Object.fromEntries(
                after
                    .filter((f) => f.status === 'deleted')
                    .map((f) => [f.s3Key, 'deleted'])
            )
        );
        const kept = after.filter((f) => f.status === 'available');
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE * kept.length,
            fileCount: kept.length,
        });
    });

    it('two confirms of one file count it once', async ({ db, user }) => {
        const [file] = await seedUploadingFiles(db, user.id, 1);

        await Promise.all([
            fileService.confirmUpload(db, user.id, file.id),
            fileService.confirmUpload(db, user.id, file.id),
        ]);

        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
        // Only the winner enqueues the thumbnail job.
        expect(jobMocks.publish).toHaveBeenCalledOnce();
    });

    // Two tabs resuming the same multipart record from shared IndexedDB.
    it('two completes of one multipart upload count it once', async ({
        db,
        user,
    }) => {
        const [file] = await seedUploadingFiles(db, user.id, 1);
        const input = { fileId: file.id, ...MULTIPART };

        await Promise.all([
            fileService.completeMultipartUpload(db, user.id, input),
            fileService.completeMultipartUpload(db, user.id, input),
        ]);

        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });

    // Two tabs cancelling the same resumed record, or a cancel meeting the
    // stale-upload reaper.
    it('two aborts of one multipart upload abort it in S3 once', async ({
        db,
        user,
    }) => {
        const [file] = await seedUploadingFiles(db, user.id, 1);

        await Promise.all([
            fileService.abortMultipartUpload(
                db,
                user.id,
                file.id,
                MULTIPART.uploadId
            ),
            fileService.abortMultipartUpload(
                db,
                user.id,
                file.id,
                MULTIPART.uploadId
            ),
        ]);

        const [after] = await readFiles(db, [file.id]);
        expect(after.status).toBe('deleted');
        expect(s3Mocks.abortMultipart).toHaveBeenCalledOnce();
    });

    it('aborting an upload that already confirmed leaves it counted and its parts alone (#361)', async ({
        db,
        user,
    }) => {
        const [file] = await seedUploadingFiles(db, user.id, 1);
        await fileService.confirmUpload(db, user.id, file.id);

        await fileService.abortMultipartUpload(
            db,
            user.id,
            file.id,
            MULTIPART.uploadId
        );

        const [after] = await readFiles(db, [file.id]);
        expect(after.status).toBe('available');
        expect(s3Mocks.abortMultipart).not.toHaveBeenCalled();
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });
});
