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
    insertStorageUsage,
    deleteUserData,
    deleteUserByEmail,
    resetUserData,
    type Connection,
} from '@nexus/db/test-db';

// The database is real — that's the point: this pins the atomicity of the
// `usedBytes + n` upsert in storage-usage and of the upload status claims,
// which no mock can express. Only the out-of-process effects are faked.
const s3Mocks = vi.hoisted(() => ({
    remove: vi.fn(),
    abort: vi.fn(),
    complete: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({ jobs: { publish: vi.fn() } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/storage', () => ({
    s3: {
        objects: { remove: s3Mocks.remove },
        multipart: { abort: s3Mocks.abort, complete: s3Mocks.complete },
    },
}));

import { fileService } from './files';

/**
 * Uploads run several files at once (#340), so a batch's `confirmUpload` calls
 * now overlap. They all increment one `storage_usage` row, and the whole
 * no-new-accounting decision rests on that increment being a SQL-side
 * `usedBytes + n` upsert rather than a read-modify-write — a lost update here
 * would silently under-bill every concurrent upload.
 */
const db: Connection = createDb(process.env.DATABASE_URL!);

const CONCURRENCY = 6;
// Prime-ish, so a lost update can't happen to sum to the right number anyway.
const FILE_SIZE = 1_000_003;

let userId: string;

beforeAll(async () => {
    const user = await insertUser(db);
    userId = user.id;
});

afterEach(async () => {
    vi.clearAllMocks();
    await resetUserData(db, userId);
});

afterAll(async () => {
    await deleteUserData(db, userId);
});

function seedUploadingFiles(owner: string, count: number) {
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

async function readUsage(owner: string) {
    const usage = await db.query.storageUsage.findFirst({
        where: (u, { eq }) => eq(u.userId, owner),
    });
    return {
        usedBytes: Number(usage?.usedBytes ?? 0),
        fileCount: usage?.fileCount ?? 0,
    };
}

const UPLOAD_ID = 'upload-id';

function completeInput(fileId: string) {
    return {
        fileId,
        uploadId: UPLOAD_ID,
        parts: [{ partNumber: 1, etag: '"etag"' }],
    };
}

async function readStatus(s3Key: string) {
    const file = await db.query.files.findFirst({
        where: (f, { eq }) => eq(f.s3Key, s3Key),
    });
    return file?.status;
}

describe('confirmUpload under concurrency', () => {
    it('lands the same usage as serial confirms when fired concurrently', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
        const files = await seedUploadingFiles(userId, CONCURRENCY);

        await Promise.all(
            files.map((file) => fileService.confirmUpload(db, userId, file.id))
        );

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE * CONCURRENCY,
            fileCount: CONCURRENCY,
        });
    });

    it('counts correctly when no usage row exists yet', async () => {
        // A user's first-ever upload: every concurrent confirm takes the INSERT
        // branch of the upsert and they race on the userId unique index.
        const fresh = await insertUser(db);
        try {
            const files = await seedUploadingFiles(fresh.id, CONCURRENCY);

            await Promise.all(
                files.map((file) =>
                    fileService.confirmUpload(db, fresh.id, file.id)
                )
            );

            expect(await readUsage(fresh.id)).toEqual({
                usedBytes: FILE_SIZE * CONCURRENCY,
                fileCount: CONCURRENCY,
            });
        } finally {
            await deleteUserByEmail(db, fresh.email);
        }
    });

    it('counts a file once when the same confirm fires concurrently', async () => {
        const [file] = await seedUploadingFiles(userId, 1);

        await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                fileService.confirmUpload(db, userId, file.id)
            )
        );

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });
});

/**
 * Every upload transition is a claim on the `uploading` row (#381). Before
 * that they were read-check-write, so a cancel and a confirm could both pass
 * the check: the confirm billed a file whose object the cancel deleted.
 */
describe('upload transitions under concurrency', () => {
    it('settles a confirm racing a cancel on exactly one side', async () => {
        const files = await seedUploadingFiles(userId, CONCURRENCY);
        // What each row said at the moment S3 was told to delete its object.
        const statusAtRemove = new Map<string, string | undefined>();
        s3Mocks.remove.mockImplementation(async (key: string) => {
            statusAtRemove.set(key, await readStatus(key));
        });

        await Promise.all(
            files.flatMap((file) => [
                fileService.confirmUpload(db, userId, file.id),
                fileService.abandonUpload(db, userId, file.id),
            ])
        );

        const settled = await Promise.all(
            files.map(async (file) => ({
                s3Key: file.s3Key,
                status: await readStatus(file.s3Key),
            }))
        );
        const confirmed = settled.filter((f) => f.status === 'available');
        const released = settled.filter((f) => f.status === 'deleted');
        expect(confirmed.length + released.length).toBe(CONCURRENCY);
        // Only the cancels that won touched S3, and only after their claim.
        expect(Object.fromEntries(statusAtRemove)).toEqual(
            Object.fromEntries(released.map((f) => [f.s3Key, 'deleted']))
        );
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE * confirmed.length,
            fileCount: confirmed.length,
        });
    });

    // Two tabs resuming the same multipart record from shared IndexedDB.
    it('counts a multipart file once when two completes race', async () => {
        const [file] = await seedUploadingFiles(userId, 1);

        await Promise.all([
            fileService.completeMultipartUpload(
                db,
                userId,
                completeInput(file.id)
            ),
            fileService.completeMultipartUpload(
                db,
                userId,
                completeInput(file.id)
            ),
        ]);

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });

    it('leaves a completed file alone when an abort arrives after it', async () => {
        const [file] = await seedUploadingFiles(userId, 1);
        await fileService.completeMultipartUpload(
            db,
            userId,
            completeInput(file.id)
        );

        await fileService.abortMultipartUpload(db, userId, file.id, UPLOAD_ID);

        expect(await readStatus(file.s3Key)).toBe('available');
        expect(s3Mocks.abort).not.toHaveBeenCalled();
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });
});
