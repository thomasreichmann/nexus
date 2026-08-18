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
// `usedBytes + n` upsert in storage-usage, which no mock can express. Only the
// out-of-process effects are faked.
vi.mock('@/lib/jobs', () => ({ jobs: { publish: vi.fn() } }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/storage', () => ({ s3: {} }));

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
