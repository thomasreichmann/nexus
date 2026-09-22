import {
    describe,
    it,
    expect,
    beforeAll,
    beforeEach,
    afterAll,
    afterEach,
    vi,
} from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
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
// `usedBytes + n` upsert in storage-usage, which no mock can express. Only the
// out-of-process effects are faked.
vi.mock('@/lib/jobs', () => ({ jobs: { publish: vi.fn() } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }));
// S3 calls take real time, which is the window the release/confirm race lives
// in (#381) — the delay widens it so the interleaving actually happens.
const S3_LATENCY_MS = 150;
const s3Mocks = vi.hoisted(() => ({
    remove: vi.fn(),
    abort: vi.fn(),
    complete: vi.fn(),
}));
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

beforeEach(() => {
    for (const mock of Object.values(s3Mocks)) {
        mock.mockReset().mockImplementation(() => sleep(S3_LATENCY_MS));
    }
});

afterEach(async () => {
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

async function readStatus(fileId: string) {
    const file = await db.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, fileId),
    });
    return file?.status;
}

/**
 * Upload transitions used to read the status, decide, then write
 * unconditionally, so a cancel and a confirm racing on one row could both act
 * — leaving an `available`, counted file whose object the cancel had just
 * deleted (#381). Whichever side wins, the row, the S3 side effects and the
 * usage counter must tell the same story.
 */
describe('upload transitions under concurrency', () => {
    it('confirm racing a cancel never leaves a counted file without its object', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
        const files = await seedUploadingFiles(userId, CONCURRENCY);

        await Promise.all(
            files.map((file) =>
                Promise.allSettled([
                    fileService.abandonUpload(db, userId, file.id),
                    fileService.confirmUpload(db, userId, file.id),
                ])
            )
        );

        const removedKeys = new Set(s3Mocks.remove.mock.calls.map(([k]) => k));
        let confirmed = 0;
        for (const file of files) {
            const status = await readStatus(file.id);
            if (status === 'available') {
                confirmed++;
                expect(removedKeys.has(file.s3Key)).toBe(false);
            } else {
                expect(status).toBe('deleted');
                expect(removedKeys.has(file.s3Key)).toBe(true);
            }
        }
        expect(s3Mocks.remove).toHaveBeenCalledTimes(CONCURRENCY - confirmed);
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE * confirmed,
            fileCount: confirmed,
        });
    }, 20_000);

    it('counts a file once when two confirms race on it', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
        const [file] = await seedUploadingFiles(userId, 1);

        await Promise.all([
            fileService.confirmUpload(db, userId, file.id),
            fileService.confirmUpload(db, userId, file.id),
        ]);

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    }, 20_000);

    // Two tabs resuming the same multipart record from shared IndexedDB.
    it('counts a file once when two multipart completions race on it', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
        const [file] = await seedUploadingFiles(userId, 1);
        const input = {
            fileId: file.id,
            uploadId: 'upload-id',
            parts: [{ partNumber: 1, etag: '"etag"' }],
        };

        await Promise.all([
            fileService.completeMultipartUpload(db, userId, input),
            fileService.completeMultipartUpload(db, userId, input),
        ]);

        expect(await readStatus(file.id)).toBe('available');
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    }, 20_000);

    it('aborts a multipart upload in S3 once when two aborts race', async () => {
        const [file] = await seedUploadingFiles(userId, 1);

        await Promise.all([
            fileService.abortMultipartUpload(db, userId, file.id, 'upload-id'),
            fileService.abortMultipartUpload(db, userId, file.id, 'upload-id'),
        ]);

        expect(s3Mocks.abort).toHaveBeenCalledOnce();
        expect(await readStatus(file.id)).toBe('deleted');
    }, 20_000);

    it('leaves the row uploading when the S3 delete fails', async () => {
        const [file] = await seedUploadingFiles(userId, 1);
        s3Mocks.remove.mockRejectedValueOnce(new Error('S3 unavailable'));

        await expect(
            fileService.abandonUpload(db, userId, file.id)
        ).rejects.toThrow('S3 unavailable');

        expect(await readStatus(file.id)).toBe('uploading');
    }, 20_000);
});
