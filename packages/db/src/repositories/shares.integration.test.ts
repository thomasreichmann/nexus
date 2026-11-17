import {
    it,
    expect,
    describe,
    inRolledBackTransaction,
} from '../test-db/integration';
import { deleteShares, insertShare, type DB, type Share } from '../test-db';
import { createShareRepo } from './shares';

const NOW = new Date('2026-11-17T12:00:00Z');
const justBefore = (date: Date) => new Date(date.getTime() - 1);
const justAfter = (date: Date) => new Date(date.getTime() + 1);

/** `shares` rows belong to no user, so each test removes its own. */
async function withShares(
    db: DB,
    fn: (seed: typeof insertShare) => Promise<void>
): Promise<void> {
    const ids: string[] = [];
    try {
        await fn(async (dbOrTx, overrides, files) => {
            const share = await insertShare(dbOrTx, overrides, files);
            ids.push(share.id);
            return share;
        });
    } finally {
        await deleteShares(db, ids);
    }
}

describe.concurrent('findActive', () => {
    it('returns a ready, unexpired share with its files in the order they were picked', async ({
        db,
    }) => {
        await withShares(db, async (seed) => {
            const share = await seed(
                db,
                { status: 'ready', expiresAt: justAfter(NOW) },
                [
                    { name: 'second.txt', position: 1 },
                    { name: 'first.txt', position: 0 },
                ]
            );

            const found = await createShareRepo(db).findActive(share.id, NOW);

            expect(found?.id).toBe(share.id);
            expect(found?.files.map((file) => file.name)).toEqual([
                'first.txt',
                'second.txt',
            ]);
        });
    });

    it('returns only that share’s files', async ({ db }) => {
        await withShares(db, async (seed) => {
            const share = await seed(db, {}, [{ name: 'mine.txt' }]);
            await seed(db, {}, [{ name: 'theirs.txt' }]);

            const found = await createShareRepo(db).findActive(share.id);

            expect(found?.files.map((file) => file.name)).toEqual(['mine.txt']);
        });
    });

    it('finds nothing under an id that is no share, whatever else is live', async ({
        db,
    }) => {
        await withShares(db, async (seed) => {
            await seed(db, { status: 'ready', expiresAt: justAfter(NOW) });
            const repo = createShareRepo(db);

            expect(await repo.findActive('no-such-share', NOW)).toBeUndefined();
            expect(await repo.findWithFiles('no-such-share')).toBeUndefined();
        });
    });

    it('hides a share that is still uploading', async ({ db }) => {
        await withShares(db, async (seed) => {
            const share = await seed(db, {
                status: 'uploading',
                expiresAt: justAfter(NOW),
            });

            expect(
                await createShareRepo(db).findActive(share.id, NOW)
            ).toBeUndefined();
        });
    });

    it('hides a share from the instant it expires', async ({ db }) => {
        await withShares(db, async (seed) => {
            const share = await seed(db, { status: 'ready', expiresAt: NOW });
            const repo = createShareRepo(db);

            expect(await repo.findActive(share.id, NOW)).toBeUndefined();
            expect((await repo.findActive(share.id, justBefore(NOW)))?.id).toBe(
                share.id
            );
        });
    });
});

describe.concurrent('markReady', () => {
    it('turns an uploading share on, and leaves every other share as it was', async ({
        db,
    }) => {
        await withShares(db, async (seed) => {
            const repo = createShareRepo(db);
            const share = await seed(db, {
                status: 'uploading',
                expiresAt: justAfter(NOW),
            });
            const other = await seed(db, {
                status: 'uploading',
                expiresAt: justAfter(NOW),
            });

            const marked = await repo.markReady(share.id, NOW);

            expect(marked).toMatchObject({ id: share.id, status: 'ready' });
            expect((await repo.findWithFiles(other.id))?.status).toBe(
                'uploading'
            );
        });
    });

    it('refuses a share that has reached its expiry', async ({ db }) => {
        await withShares(db, async (seed) => {
            const repo = createShareRepo(db);
            const share = await seed(db, {
                status: 'uploading',
                expiresAt: NOW,
            });

            expect(await repo.markReady(share.id, NOW)).toBeUndefined();
            expect((await repo.findWithFiles(share.id))?.status).toBe(
                'uploading'
            );
        });
    });

    it('returns nothing for a share that is already ready', async ({ db }) => {
        await withShares(db, async (seed) => {
            const share = await seed(db, {
                status: 'ready',
                expiresAt: justAfter(NOW),
            });

            expect(
                await createShareRepo(db).markReady(share.id, NOW)
            ).toBeUndefined();
        });
    });
});

describe.concurrent('claimDownload', () => {
    it('counts downloads of that file up to the limit, then refuses', async ({
        db,
    }) => {
        await withShares(db, async (seed) => {
            const repo = createShareRepo(db);
            const share = await seed(db, {}, [
                { name: 'wanted.txt', downloadCount: 1 },
                { name: 'untouched.txt' },
            ]);
            const [wanted, untouched] = share.files;

            const second = await repo.claimDownload(wanted!.id, 3);
            const third = await repo.claimDownload(wanted!.id, 3);
            const fourth = await repo.claimDownload(wanted!.id, 3);

            expect(second?.downloadCount).toBe(2);
            expect(third?.downloadCount).toBe(3);
            expect(fourth).toBeUndefined();
            const stored = await repo.findWithFiles(share.id);
            expect(
                stored?.files.map((file) => [file.id, file.downloadCount])
            ).toEqual([
                [wanted!.id, 3],
                [untouched!.id, 0],
            ]);
        });
    });

    it('lets only as many through as the limit has left when downloads race', async ({
        db,
    }) => {
        await withShares(db, async (seed) => {
            const repo = createShareRepo(db);
            const share = await seed(db, {}, [{ downloadCount: 8 }]);
            const fileId = share.files[0]!.id;

            const claims = await Promise.all(
                Array.from({ length: 6 }, () => repo.claimDownload(fileId, 10))
            );

            expect(claims.filter(Boolean)).toHaveLength(2);
            const stored = await repo.findWithFiles(share.id);
            expect(stored?.files[0]?.downloadCount).toBe(10);
        });
    });
});

describe('usageSince', () => {
    // The global sum scans the whole table, which other runs write to. Inside
    // one rolled-back snapshot, the difference between two reads is exactly
    // what this test inserted.
    it('counts an uploader’s own shares for them and everyone’s bytes for the global sum, from strictly after the cutoff', async ({
        db,
    }) => {
        await inRolledBackTransaction(db, async (tx) => {
            const repo = createShareRepo(tx);
            const uploader = `usage-${crypto.randomUUID()}`;
            const before = await repo.usageSince(uploader, NOW);
            const seed = (overrides: Partial<Share>) =>
                insertShare(tx, { status: 'uploading', ...overrides });

            await seed({
                ipHash: uploader,
                totalSize: 100,
                createdAt: justAfter(NOW),
            });
            await seed({
                ipHash: uploader,
                totalSize: 20,
                status: 'ready',
                createdAt: justAfter(NOW),
            });
            // At the cutoff exactly: outside the window.
            await seed({ ipHash: uploader, totalSize: 7, createdAt: NOW });
            // Someone else's: global only.
            await seed({ totalSize: 3000, createdAt: justAfter(NOW) });

            const after = await repo.usageSince(uploader, NOW);

            expect(before).toMatchObject({ ipShares: 0, ipBytes: 0 });
            expect(after).toMatchObject({ ipShares: 2, ipBytes: 120 });
            expect(after.globalBytes - before.globalBytes).toBe(3120);
        });
    });
});

describe('tryLockUploader', () => {
    it('is held by one transaction at a time per uploader, and released when it ends', async ({
        db,
    }) => {
        const uploader = `lock-${crypto.randomUUID()}`;
        let releaseHolder = () => {};
        const holderMayFinish = new Promise<void>((resolve) => {
            releaseHolder = resolve;
        });
        let holderHasLock = () => {};
        const holderLocked = new Promise<void>((resolve) => {
            holderHasLock = resolve;
        });

        const holder = db.transaction(async (tx) => {
            expect(await createShareRepo(tx).tryLockUploader(uploader)).toBe(
                true
            );
            holderHasLock();
            await holderMayFinish;
        });
        await holderLocked;

        const whileHeld = await db.transaction(async (tx) => ({
            sameUploader: await createShareRepo(tx).tryLockUploader(uploader),
            otherUploader: await createShareRepo(tx).tryLockUploader(
                `lock-${crypto.randomUUID()}`
            ),
        }));
        releaseHolder();
        await holder;
        const afterRelease = await db.transaction((tx) =>
            createShareRepo(tx).tryLockUploader(uploader)
        );

        expect(whileHeld).toEqual({ sameUploader: false, otherUploader: true });
        expect(afterRelease).toBe(true);
    });
});
