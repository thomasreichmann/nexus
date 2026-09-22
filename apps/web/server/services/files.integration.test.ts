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
    // A real DeleteObject is a network round trip, and that gap is the window
    // a racing confirm used to slip through — so the fake takes one too.
    removeObject: vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 20))
    ),
    completeMultipart: vi.fn(),
    abortMultipart: vi.fn(),
}));

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

    function readFiles(ids: string[]) {
        return db.query.files.findMany({
            where: (f, { inArray }) => inArray(f.id, ids),
        });
    }

    it('a cancel racing a confirm either releases the upload or counts it, never both', async () => {
        const files = await seedUploadingFiles(userId, CONCURRENCY);

        await Promise.all(
            files.map((file) =>
                Promise.all([
                    fileService.confirmUpload(db, userId, file.id),
                    fileService.abandonUpload(db, userId, file.id),
                ])
            )
        );

        const removedKeys = new Set(
            s3Mocks.removeObject.mock.calls.map(([key]) => key)
        );
        const after = await readFiles(files.map((f) => f.id));
        for (const file of after) {
            expect(['available', 'deleted']).toContain(file.status);
            // The bytes are gone exactly when the row says released — an
            // `available` file with no object is the silent loss this guards.
            expect(removedKeys.has(file.s3Key)).toBe(file.status === 'deleted');
        }
        const kept = after.filter((f) => f.status === 'available');
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE * kept.length,
            fileCount: kept.length,
        });
    });

    it('two confirms of one file count it once', async () => {
        const [file] = await seedUploadingFiles(userId, 1);

        await Promise.all([
            fileService.confirmUpload(db, userId, file.id),
            fileService.confirmUpload(db, userId, file.id),
        ]);

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
        // Only the winner enqueues the thumbnail job.
        expect(jobMocks.publish).toHaveBeenCalledOnce();
    });

    // Two tabs resuming the same multipart record from shared IndexedDB.
    it('two completes of one multipart upload count it once', async () => {
        const [file] = await seedUploadingFiles(userId, 1);
        const input = { fileId: file.id, ...MULTIPART };

        await Promise.all([
            fileService.completeMultipartUpload(db, userId, input),
            fileService.completeMultipartUpload(db, userId, input),
        ]);

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });

    it('aborting an upload that already confirmed leaves it counted and its parts alone (#361)', async () => {
        const [file] = await seedUploadingFiles(userId, 1);
        await fileService.confirmUpload(db, userId, file.id);

        await fileService.abortMultipartUpload(
            db,
            userId,
            file.id,
            MULTIPART.uploadId
        );

        const [after] = await readFiles([file.id]);
        expect(after.status).toBe('available');
        expect(s3Mocks.abortMultipart).not.toHaveBeenCalled();
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });
});
