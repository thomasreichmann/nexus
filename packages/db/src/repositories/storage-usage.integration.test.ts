import { it, expect, describe } from '../test-db/integration';
import { insertStorageUsage } from '../test-db';
import { createStorageUsageRepo } from './storage-usage';

// Concurrent increments (the reason the SET is `used_bytes + excluded`) are
// covered end to end in apps/web's files.integration.test.ts.
describe.concurrent('storage-usage repository', () => {
    it('reads a user’s own usage row and zeros when they have none', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createStorageUsageRepo(db);
        const other = await createUser();
        await insertStorageUsage(db, {
            userId: other.id,
            usedBytes: 4096,
            fileCount: 4,
        });

        expect(await repo.getUsage(user.id)).toEqual({
            usedBytes: 0,
            fileCount: 0,
        });
        expect(await repo.getUsage(other.id)).toEqual({
            usedBytes: 4096,
            fileCount: 4,
        });
    });

    it('incrementUsage starts a first-time uploader at the upload’s size', async ({
        db,
        user,
    }) => {
        const repo = createStorageUsageRepo(db);

        const snapshot = await repo.incrementUsage(user.id, 1024);

        expect(snapshot).toEqual({ usedBytes: 1024, fileCount: 1 });
        expect(await repo.getUsage(user.id)).toEqual(snapshot);
    });

    it('incrementUsage adds to an existing row rather than overwriting it', async ({
        db,
        user,
    }) => {
        const repo = createStorageUsageRepo(db);
        await insertStorageUsage(db, {
            userId: user.id,
            usedBytes: 5000,
            fileCount: 3,
        });

        const snapshot = await repo.incrementUsage(user.id, 1024);

        expect(snapshot).toEqual({ usedBytes: 6024, fileCount: 4 });
        expect(await repo.getUsage(user.id)).toEqual(snapshot);
    });

    it('decrementUsage subtracts a batch from the user’s row only', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createStorageUsageRepo(db);
        const other = await createUser();
        await insertStorageUsage(db, {
            userId: user.id,
            usedBytes: 5000,
            fileCount: 5,
        });
        await insertStorageUsage(db, {
            userId: other.id,
            usedBytes: 5000,
            fileCount: 5,
        });

        const snapshot = await repo.decrementUsage(user.id, 3000, 2);

        expect(snapshot).toEqual({ usedBytes: 2000, fileCount: 3 });
        expect(await repo.getUsage(other.id)).toEqual({
            usedBytes: 5000,
            fileCount: 5,
        });
    });

    it('decrementUsage clamps at zero instead of going negative', async ({
        db,
        user,
    }) => {
        const repo = createStorageUsageRepo(db);
        await insertStorageUsage(db, {
            userId: user.id,
            usedBytes: 100,
            fileCount: 1,
        });

        const snapshot = await repo.decrementUsage(user.id, 5000, 3);

        expect(snapshot).toEqual({ usedBytes: 0, fileCount: 0 });
    });

    it('decrementUsage returns zeros when the user has no row', async ({
        db,
        user,
    }) => {
        expect(
            await createStorageUsageRepo(db).decrementUsage(user.id, 100)
        ).toEqual({ usedBytes: 0, fileCount: 0 });
    });
});
