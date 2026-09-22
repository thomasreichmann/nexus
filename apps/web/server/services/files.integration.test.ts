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
// `usedBytes + n` upsert in storage-usage and of the upload-state claims
// (#381), neither of which a mock can express. Only the out-of-process effects
// are faked.
vi.mock('@/lib/jobs', () => ({ jobs: { publish: vi.fn() } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }));

// S3 is the one effect the race tests need to observe rather than ignore: the
// whole point of claiming before releasing is that the losing side issues no
// DeleteObject at all. The shared double carries every namespace, so a service
// that reaches for a method these tests didn't anticipate still gets one.
vi.mock('@/lib/storage', async () => ({
    s3: (await import('@/lib/storage/testing')).mockS3,
}));

import { createFileRepo } from '@nexus/db/repo/files';
import { mockS3 } from '@/lib/storage/testing';
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
// Rounds of the confirm-vs-cancel race. Which side wins is up to the
// scheduler, so one round is one sample; a handful keeps the cost trivial
// while making it unlikely that every round picks the same ordering.
const RACE_ROUNDS = 10;

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

async function readStatus(fileId: string) {
    const file = await db.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, fileId),
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
});

/**
 * Upload transitions used to read the row, check `status === 'uploading'`, and
 * then UPDATE on the id alone. Under Read Committed the check and the write
 * are two separate decisions, so a cancel and a confirm could both pass their
 * guard and the second UPDATE simply overwrote the first — a file listed as
 * archived whose S3 object was already deleted (#381).
 *
 * A mocked db can't fail that way: it resolves whatever the test tells it to,
 * so a sequential setup only ever proves the guard branch. These need the real
 * thing, where two statements really do contend for one row's lock.
 */
describe('atomic upload claims (#381)', () => {
    // The heart of the fix, at its narrowest: two claims on one row, opposite
    // targets. Postgres serializes them and the loser re-checks the predicate
    // against the winner's committed row, so it matches nothing.
    it('lets exactly one of a confirm claim and a release claim win', async () => {
        const [file] = await seedUploadingFiles(userId, 1);
        const repo = createFileRepo(db);

        const claims = await Promise.all([
            repo.claimUploading(userId, file.id, 'available'),
            repo.claimUploading(userId, file.id, 'deleted'),
        ]);

        expect(claims.filter(Boolean)).toHaveLength(1);
    });

    // The quota-drift half of the issue: two tabs resuming one multipart
    // record both passed the old read-then-check guard and both billed.
    it('increments usage once when one file is confirmed concurrently', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
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

    it('increments usage once when one multipart upload completes concurrently', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
        const [file] = await seedUploadingFiles(userId, 1);

        await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                fileService.completeMultipartUpload(db, userId, {
                    fileId: file.id,
                    uploadId: 'upload-id',
                    parts: [{ partNumber: 1, etag: '"etag"' }],
                })
            )
        );

        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE,
            fileCount: 1,
        });
    });

    /**
     * The data-loss race itself. Which side wins is genuinely up to the
     * scheduler, so the assertion is the invariant rather than an outcome:
     * the file is confirmed *or* released, and the branch that the row landed
     * on is the one that got to spend a DeleteObject and a usage increment.
     *
     * Before the fix the losing confirm's unpredicated UPDATE could land last
     * and produce the forbidden fourth combination — `available`, billed, and
     * its object already deleted. Repeated rounds so one scheduling accident
     * doesn't decide whether the test looked.
     */
    it('leaves a raced upload fully confirmed or fully released, never both', async () => {
        await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
        const files = await seedUploadingFiles(userId, RACE_ROUNDS);
        const remove = vi.spyOn(mockS3.objects, 'remove');
        let confirmedCount = 0;

        for (const file of files) {
            remove.mockClear();

            await Promise.all([
                fileService.confirmUpload(db, userId, file.id),
                fileService.abandonUpload(db, userId, file.id),
            ]);

            const status = await readStatus(file.id);

            if (status === 'available') {
                // Confirmed: the bytes the user now owns are still in S3.
                expect(remove).not.toHaveBeenCalled();
                confirmedCount += 1;
            } else {
                expect(status).toBe('deleted');
                // Released: the object goes, and nothing was ever billed.
                expect(remove).toHaveBeenCalledExactlyOnceWith(file.s3Key);
            }
        }

        // Usage counts exactly the files that ended up confirmed — no
        // increment survived on a row that was released instead.
        expect(await readUsage(userId)).toEqual({
            usedBytes: FILE_SIZE * confirmedCount,
            fileCount: confirmedCount,
        });
    });
});
