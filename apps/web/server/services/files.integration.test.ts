import { vi } from 'vitest';
import { it, describe, expect, afterEach } from '@nexus/db/test-db/integration';
import {
    insertFile,
    insertStorageUsage,
    insertUploadBatch,
    type DB,
} from '@nexus/db/test-db';

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
        presignedPut: vi.fn(async () => 'https://s3.test/put'),
        createMultipart: vi.fn(async () => ({ uploadId: 'upload-1' })),
        signParts: vi.fn(async () => ['https://s3.test/part/1']),
    };
});

const jobMocks = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@/lib/jobs', () => ({ jobs: { publish: jobMocks.publish } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/storage', () => ({
    s3: {
        objects: { remove: s3Mocks.removeObject },
        presigned: { put: s3Mocks.presignedPut },
        multipart: {
            create: s3Mocks.createMultipart,
            signParts: s3Mocks.signParts,
            complete: s3Mocks.completeMultipart,
            abort: s3Mocks.abortMultipart,
        },
    },
}));

import { createFileRepo } from '@nexus/db/repo/files';
import { createUploadBatchRepo } from '@nexus/db/repo/uploadBatches';
import { NotFoundError } from '@/server/errors';
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

function readFiles(db: DB, ids: string[]) {
    return db.query.files.findMany({
        where: (f, { inArray }) => inArray(f.id, ids),
    });
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

// #408: a shoot is filed by what it was, not by when its upload ran.
describe('renameBatch', () => {
    const nameOf = async (db: DB, userId: string, batchId: string) =>
        (await createUploadBatchRepo(db).findByUserAndId(userId, batchId))
            ?.name;

    it('renames the batch asked for, and not the owner’s other one', async ({
        db,
        user,
    }) => {
        const [batch, other] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'Upload 1' }),
            insertUploadBatch(db, { userId: user.id, name: 'Upload 2' }),
        ]);

        const result = await fileService.renameBatch(
            db,
            user.id,
            batch.id,
            'Silva wedding'
        );

        expect(result).toEqual({ batchId: batch.id, name: 'Silva wedding' });
        expect(await nameOf(db, user.id, batch.id)).toBe('Silva wedding');
        expect(await nameOf(db, user.id, other.id)).toBe('Upload 2');
    });

    it('refuses another user’s batch and leaves its name', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const theirs = await insertUploadBatch(db, {
            userId: stranger.id,
            name: 'Theirs',
        });

        await expect(
            fileService.renameBatch(db, user.id, theirs.id, 'Mine now')
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(await nameOf(db, stranger.id, theirs.id)).toBe('Theirs');
    });
});

// Files by id: a file's own menu sends one, the selection bar a set. Each
// usage row starts with a file outside the set still counted, so a wrong
// decrement can't hide at zero.
describe('deleteUserFile', () => {
    it('deletes the files and gives back the bytes of the ones that were counted', async ({
        db,
        user,
    }) => {
        const [a, b, uploading] = await Promise.all([
            insertFile(db, { userId: user.id, size: 100 }),
            insertFile(db, { userId: user.id, size: 200 }),
            // Never confirmed, so never counted.
            insertFile(db, {
                userId: user.id,
                size: 400,
                status: 'uploading',
            }),
            insertStorageUsage(db, {
                userId: user.id,
                usedBytes: 1300,
                fileCount: 3,
            }),
        ]);
        const ids = [a.id, b.id, uploading.id];

        await fileService.deleteUserFile(db, user.id, ids);

        expect((await readFiles(db, ids)).map((f) => f.status)).toEqual([
            'deleted',
            'deleted',
            'deleted',
        ]);
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: 1000,
            fileCount: 1,
        });
    });

    // #477: deleted from its own menu, then sent again with the selection.
    it('skips a file that’s already deleted and deletes the rest', async ({
        db,
        user,
    }) => {
        const [gone, file] = await Promise.all([
            insertFile(db, { userId: user.id, size: 100, status: 'deleted' }),
            insertFile(db, { userId: user.id, size: 200 }),
            // The gone file's delete already gave its bytes back.
            insertStorageUsage(db, {
                userId: user.id,
                usedBytes: 1200,
                fileCount: 2,
            }),
        ]);

        const deleted = await fileService.deleteUserFile(db, user.id, [
            gone.id,
            file.id,
        ]);

        expect(deleted.map((f) => f.id)).toEqual([file.id]);
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: 1000,
            fileCount: 1,
        });
    });

    // A file's own menu, on a file another tab already deleted.
    it('deleting one file that’s already deleted does nothing', async ({
        db,
        user,
    }) => {
        const [gone] = await Promise.all([
            insertFile(db, { userId: user.id, size: 100, status: 'deleted' }),
            insertStorageUsage(db, {
                userId: user.id,
                usedBytes: 1000,
                fileCount: 1,
            }),
        ]);

        await expect(
            fileService.deleteUserFile(db, user.id, gone.id)
        ).resolves.toBeUndefined();
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: 1000,
            fileCount: 1,
        });
    });

    it('two deletes of one file give its bytes back once', async ({
        db,
        user,
    }) => {
        const [file] = await Promise.all([
            insertFile(db, { userId: user.id, size: FILE_SIZE }),
            insertStorageUsage(db, {
                userId: user.id,
                usedBytes: FILE_SIZE * 2,
                fileCount: 2,
            }),
        ]);

        await Promise.all([
            fileService.deleteUserFile(db, user.id, file.id),
            fileService.deleteUserFile(db, user.id, [file.id]),
        ]);

        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });

    it('refuses a set holding another user’s file, and deletes none of it', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [mine, theirs] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: stranger.id }),
        ]);

        await expect(
            fileService.deleteUserFile(db, user.id, [mine.id, theirs.id])
        ).rejects.toBeInstanceOf(NotFoundError);
        const after = await readFiles(db, [mine.id, theirs.id]);
        expect(after.map((f) => f.status)).toEqual(['available', 'available']);
    });
});

// #455: a whole batch by id, however much of it a browser has paged in.
describe('deleteBatch', () => {
    it('deletes the batch’s visible files and gives their bytes back to usage', async ({
        db,
        user,
    }) => {
        const [batch, other] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const [a, b, uploading, elsewhere] = await Promise.all([
            insertFile(db, { userId: user.id, batchId: batch.id, size: 100 }),
            insertFile(db, { userId: user.id, batchId: batch.id, size: 200 }),
            // Never counted, and still owed its S3 cleanup by releaseUpload.
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                size: 400,
                status: 'uploading',
            }),
            insertFile(db, { userId: user.id, batchId: other.id, size: 800 }),
            insertStorageUsage(db, {
                userId: user.id,
                usedBytes: 1100,
                fileCount: 3,
            }),
        ]);

        const result = await fileService.deleteBatch(db, user.id, batch.id);

        expect(result).toEqual({ deletedCount: 2 });
        expect(
            Object.fromEntries(
                (
                    await readFiles(db, [
                        a.id,
                        b.id,
                        uploading.id,
                        elsewhere.id,
                    ])
                ).map((f) => [f.id, f.status])
            )
        ).toEqual({
            [a.id]: 'deleted',
            [b.id]: 'deleted',
            [uploading.id]: 'uploading',
            [elsewhere.id]: 'available',
        });
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: 800,
            fileCount: 1,
        });
    });

    it('refuses another user’s batch and deletes nothing', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const theirs = await insertUploadBatch(db, { userId: stranger.id });
        // A row of the user's own filed under the stranger's batch: the
        // owner-scoped delete alone would take it, the batch check refuses.
        const [file, mine] = await Promise.all([
            insertFile(db, { userId: stranger.id, batchId: theirs.id }),
            insertFile(db, { userId: user.id, batchId: theirs.id }),
        ]);

        await expect(
            fileService.deleteBatch(db, user.id, theirs.id)
        ).rejects.toBeInstanceOf(NotFoundError);
        const after = await readFiles(db, [file.id, mine.id]);
        expect(after.map((f) => f.status)).toEqual(['available', 'available']);
    });

    it('deletes the legacy Ungrouped files when given no batch', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const [legacy, batched] = await Promise.all([
            insertFile(db, { userId: user.id, size: 10 }),
            insertFile(db, { userId: user.id, batchId: batch.id, size: 20 }),
            insertStorageUsage(db, {
                userId: user.id,
                usedBytes: 30,
                fileCount: 2,
            }),
        ]);

        expect(await fileService.deleteBatch(db, user.id, null)).toEqual({
            deletedCount: 1,
        });
        expect(
            (await readFiles(db, [legacy.id, batched.id])).map((f) => [
                f.id,
                f.status,
            ])
        ).toEqual(
            expect.arrayContaining([
                [legacy.id, 'deleted'],
                [batched.id, 'available'],
            ])
        );
        expect(await readUsage(db, user.id)).toEqual({
            usedBytes: 20,
            fileCount: 1,
        });
    });
});

// #405: the folder a file sat in, as the upload queue resolved it, lands on
// the row both engines insert.
describe('the folder a file is uploaded from', () => {
    it.for(['initiateUpload', 'initiateMultipartUpload'] as const)(
        '%s stores it',
        async (initiate, { db, user }) => {
            const { fileId } = await fileService[initiate](
                db,
                user.id,
                {
                    name: 'IMG_0001.JPG',
                    sizeBytes: 1000,
                    subpath: '104CANON',
                },
                undefined
            );

            const [file] = await readFiles(db, [fileId]);
            expect(file.subpath).toBe('104CANON');
        }
    );

    it('stores no folder for a file uploaded loose', async ({ db, user }) => {
        const { fileId } = await fileService.initiateUpload(
            db,
            user.id,
            { name: 'loose.txt', sizeBytes: 1000 },
            undefined
        );

        const [file] = await readFiles(db, [fileId]);
        expect(file.subpath).toBeNull();
    });
});

// A batch records how many files it's meant to hold, so one with fewer
// confirmed files is identifiable as partial (#399).
describe('the files a batch expects', () => {
    function readBatch(db: DB, id: string) {
        return db.query.uploadBatches.findFirst({
            where: (b, { eq }) => eq(b.id, id),
        });
    }

    it('createBatch records the name and file count the upload sends', async ({
        db,
        user,
    }) => {
        const { batchId } = await fileService.createBatch(db, user.id, {
            name: 'Silva wedding',
            expectedFileCount: 40,
        });

        expect(await readBatch(db, batchId)).toMatchObject({
            userId: user.id,
            name: 'Silva wedding',
            expectedFileCount: 40,
        });
    });

    it('createBatch falls back to a timestamp name, and expects nothing it wasn’t told', async ({
        db,
        user,
    }) => {
        const { batchId } = await fileService.createBatch(db, user.id, {});

        expect(await readBatch(db, batchId)).toMatchObject({
            name: expect.stringMatching(
                /^Upload \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
            ),
            expectedFileCount: null,
        });
    });

    // The fallback when the browser's createBatch failed: each file gets a
    // batch of its own.
    // Its retry lands in a fresh one (the browser never learned this id), so
    // an expectation here would read the first as short (#550).
    it('a file uploaded with no batch gets one recording no expectation', async ({
        db,
        user,
    }) => {
        const { fileId } = await fileService.initiateUpload(
            db,
            user.id,
            { name: 'loose.txt', sizeBytes: 1000 },
            undefined
        );

        const [file] = await readFiles(db, [fileId]);
        expect(await readBatch(db, file.batchId!)).toMatchObject({
            expectedFileCount: null,
        });
    });
});
