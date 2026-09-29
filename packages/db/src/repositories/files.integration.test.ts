import {
    it,
    expect,
    describe,
    inRolledBackTransaction,
} from '../test-db/integration';
import { insertFile, insertRetrieval, insertUploadBatch } from '../test-db';
import { createFileRepo, originalKey } from './files';

const HOUR_MS = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR_MS);
const future = () => new Date(Date.now() + HOUR_MS);
const LONG_AGO = new Date('2026-01-01T00:00:00Z');

// Every file a user reaches by id goes through one of these. Without the
// `userId` predicate, one user could read, delete or confirm another's file
// by passing its id (#489).
describe.concurrent('ownership', () => {
    it('findByUserAndId does not return another user’s file, even by its id', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createFileRepo(db);
        const stranger = await createUser();
        const mine = await insertFile(db, { userId: user.id });
        const theirs = await insertFile(db, { userId: stranger.id });

        expect((await repo.findByUserAndId(user.id, mine.id))?.id).toBe(
            mine.id
        );
        expect(await repo.findByUserAndId(user.id, theirs.id)).toBeUndefined();
    });

    it('findManyByUserAndIds returns only the user’s own files among the ids passed', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [mine, theirs] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: stranger.id }),
            // The user's, but not asked for.
            insertFile(db, { userId: user.id }),
        ]);

        const found = await createFileRepo(db).findManyByUserAndIds(user.id, [
            mine.id,
            theirs.id,
            crypto.randomUUID(),
        ]);

        expect(found.map((f) => f.id)).toEqual([mine.id]);
    });

    it('softDeleteForUser deletes the user’s live files and leaves another user’s untouched', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createFileRepo(db);
        const stranger = await createUser();
        const [live, alreadyDeleted, theirs, notAsked] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, {
                userId: user.id,
                status: 'deleted',
                deletedAt: LONG_AGO,
            }),
            insertFile(db, { userId: stranger.id }),
            // The user's, live, and not in the list: without the id filter,
            // deleting one file would delete the whole vault.
            insertFile(db, { userId: user.id }),
        ]);

        const deleted = await repo.softDeleteForUser(user.id, [
            live.id,
            alreadyDeleted.id,
            theirs.id,
        ]);

        expect(deleted.map((f) => f.id)).toEqual([live.id]);
        expect(deleted[0]).toMatchObject({
            status: 'deleted',
            deletedAt: expect.any(Date),
        });
        // Status and deletedAt as they were, and nothing else written either.
        expect(await repo.findById(theirs.id)).toEqual(theirs);
        expect(await repo.findById(notAsked.id)).toEqual(notAsked);
        // An already-deleted file keeps the time it was first deleted.
        expect((await repo.findById(alreadyDeleted.id))?.deletedAt).toEqual(
            LONG_AGO
        );
    });

    it('findByUserAndBatch returns the user’s files in that batch only', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [batch, otherBatch] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const [inBatch] = await Promise.all([
            insertFile(db, { userId: user.id, batchId: batch.id }),
            insertFile(db, { userId: user.id, batchId: otherBatch.id }),
            // Nothing in the schema stops a row pointing at someone else's
            // batch; the query's own userId filter is what keeps it out.
            insertFile(db, { userId: stranger.id, batchId: batch.id }),
        ]);

        const found = await createFileRepo(db).findByUserAndBatch(
            user.id,
            batch.id
        );

        expect(found.map((f) => f.id)).toEqual([inBatch.id]);
    });

    // The status predicate under concurrency is raced in apps/web's
    // files.integration.test.ts (#381); this is what each transition writes.
    it('claimUpload moves only the user’s own file, and only out of uploading', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createFileRepo(db);
        const stranger = await createUser();
        const [toConfirm, toRelease, confirmed, theirs] = await Promise.all([
            insertFile(db, { userId: user.id, status: 'uploading' }),
            insertFile(db, { userId: user.id, status: 'uploading' }),
            insertFile(db, { userId: user.id, status: 'available' }),
            insertFile(db, { userId: stranger.id, status: 'uploading' }),
        ]);

        expect(
            await repo.claimUpload(user.id, toConfirm.id, 'available')
        ).toMatchObject({ status: 'available', deletedAt: null });
        expect(
            await repo.claimUpload(user.id, toRelease.id, 'deleted')
        ).toMatchObject({ status: 'deleted', deletedAt: expect.any(Date) });
        expect(
            await repo.claimUpload(user.id, confirmed.id, 'deleted')
        ).toBeUndefined();
        expect(
            await repo.claimUpload(user.id, theirs.id, 'deleted')
        ).toBeUndefined();
        expect(await repo.findById(theirs.id)).toEqual(theirs);
    });
});

describe.concurrent('file browser queries', () => {
    it('list, count and storage total see the user’s visible files, hidden ones only on request', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createFileRepo(db);
        const stranger = await createUser();
        const [small, large, uploading, deleted] = await Promise.all([
            insertFile(db, { userId: user.id, size: 100 }),
            insertFile(db, { userId: user.id, size: 200 }),
            insertFile(db, { userId: user.id, size: 400, status: 'uploading' }),
            insertFile(db, { userId: user.id, size: 800, status: 'deleted' }),
            insertFile(db, { userId: stranger.id, size: 1600 }),
        ]);
        const ids = (files: { id: string }[]) =>
            new Set(files.map((f) => f.id));
        const page = { limit: 50, offset: 0 };

        expect(ids(await repo.findByUser(user.id, page))).toEqual(
            ids([small, large])
        );
        expect(await repo.countByUser(user.id)).toBe(2);
        expect(await repo.sumStorageByUser(user.id)).toBe(300);

        expect(
            ids(
                await repo.findByUser(user.id, { ...page, includeHidden: true })
            )
        ).toEqual(ids([small, large, uploading, deleted]));
        expect(await repo.countByUser(user.id, { includeHidden: true })).toBe(
            4
        );
    });

    it('search matches a literal, case-insensitive substring', async ({
        db,
        user,
    }) => {
        const repo = createFileRepo(db);
        await Promise.all(
            [
                'Report 100%.pdf',
                'report 1000.pdf',
                'foo_bar.txt',
                'fooXbar.txt',
            ].map((name) => insertFile(db, { userId: user.id, name }))
        );
        const search = async (term: string) => ({
            names: (
                await repo.findByUser(user.id, {
                    limit: 50,
                    offset: 0,
                    search: term,
                })
            ).map((f) => f.name),
            count: await repo.countByUser(user.id, { search: term }),
        });

        // `%` and `_` are LIKE wildcards; unescaped, each would match both.
        expect(await search('100%')).toEqual({
            names: ['Report 100%.pdf'],
            count: 1,
        });
        expect(await search('FOO_')).toEqual({
            names: ['foo_bar.txt'],
            count: 1,
        });
    });

    it('search ignores whitespace around the term', async ({ db, user }) => {
        await Promise.all(
            ['holiday.jpg', 'receipt.pdf'].map((name) =>
                insertFile(db, { userId: user.id, name })
            )
        );

        const found = await createFileRepo(db).findByUser(user.id, {
            limit: 50,
            offset: 0,
            search: '  holiday ',
        });

        expect(found.map((f) => f.name)).toEqual(['holiday.jpg']);
    });

    it('findByUser sorts by the chosen column and pages through it', async ({
        db,
        user,
    }) => {
        const repo = createFileRepo(db);
        const base = Date.now();
        const add = (name: string, size: number, secondsAgo: number) =>
            insertFile(db, {
                userId: user.id,
                name,
                size,
                createdAt: new Date(base - secondsAgo * 1000),
            });
        // Without an ORDER BY, rows come back in insertion order or in the
        // (user_id, created_at desc) index's order: both are newest first
        // here. Sizes don't follow upload time, so neither passes for the
        // size sort.
        const a = await add('a.pdf', 200, 0);
        const b = await add('b.pdf', 300, 1);
        await add('c.pdf', 100, 2);
        const names = (files: { name: string }[]) => files.map((f) => f.name);

        expect(
            names(
                await repo.findByUser(user.id, {
                    limit: 2,
                    offset: 1,
                    sortKey: 'size',
                    sortOrder: 'asc',
                })
            )
        ).toEqual([a.name, b.name]);
        // Default: newest upload first.
        expect(
            names(await repo.findByUser(user.id, { limit: 2, offset: 0 }))
        ).toEqual([a.name, b.name]);
    });

    it('findExistingByNameAndSize matches committed files on name and size together, once each', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        await Promise.all([
            insertFile(db, {
                userId: user.id,
                name: 'IMG_0001.CR2',
                size: 100,
            }),
            // Same name, different size: a re-export, not a duplicate.
            insertFile(db, {
                userId: user.id,
                name: 'IMG_0001.CR2',
                size: 200,
            }),
            // Two copies already in the vault answer once.
            insertFile(db, { userId: user.id, name: 'clip.mp4', size: 5 }),
            insertFile(db, { userId: user.id, name: 'clip.mp4', size: 5 }),
            // An interrupted upload was never committed (#398).
            insertFile(db, {
                userId: user.id,
                name: 'IMG_0003.CR2',
                size: 100,
                status: 'uploading',
            }),
            insertFile(db, {
                userId: stranger.id,
                name: 'IMG_0004.CR2',
                size: 100,
            }),
        ]);

        const existing = await createFileRepo(db).findExistingByNameAndSize(
            user.id,
            [
                { name: 'IMG_0001.CR2', size: 100 },
                { name: 'IMG_0002.CR2', size: 100 },
                { name: 'clip.mp4', size: 5 },
                { name: 'IMG_0003.CR2', size: 100 },
                { name: 'IMG_0004.CR2', size: 100 },
            ]
        );

        expect(
            [...existing].sort((x, y) => x.name.localeCompare(y.name))
        ).toEqual([
            { name: 'clip.mp4', size: 5 },
            { name: 'IMG_0001.CR2', size: 100 },
        ]);
    });
});

describe.concurrent('findByUserGroupedByBatch', () => {
    it('groups visible files by batch, newest batch first and legacy files last, each in name order', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [newer, older] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'Silva Wedding' }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Old Shoot',
                createdAt: past(),
            }),
        ]);
        const add = (name: string, batchId: string | null, extra = {}) =>
            insertFile(db, { userId: user.id, name, batchId, ...extra });
        // In each group the first name is the older upload, so the query's
        // newest-first order is the reverse of the name order expected.
        const [earlier, later] = [past(), new Date()];
        await Promise.all([
            add('b.jpg', newer.id, { createdAt: later }),
            add('a.jpg', newer.id, { createdAt: earlier }),
            add('hidden.jpg', newer.id, { status: 'uploading' }),
            add('IMG_10.JPG', older.id, { createdAt: later }),
            add('IMG_9.JPG', older.id, { createdAt: earlier }),
            add('f.jpg', null, { createdAt: later }),
            add('e.jpg', null, { createdAt: earlier }),
            insertFile(db, { userId: stranger.id, batchId: newer.id }),
        ]);

        const groups = await createFileRepo(db).findByUserGroupedByBatch(
            user.id
        );

        expect(
            groups.map((g) => [
                g.batchId,
                g.batchName,
                g.files.map((f) => f.name),
            ])
        ).toEqual([
            [newer.id, 'Silva Wedding', ['a.jpg', 'b.jpg']],
            [older.id, 'Old Shoot', ['IMG_9.JPG', 'IMG_10.JPG']],
            [null, null, ['e.jpg', 'f.jpg']],
        ]);
    });

    it('includes uploading and deleted files when asked to', async ({
        db,
        user,
    }) => {
        await Promise.all([
            insertFile(db, { userId: user.id, name: 'a.jpg' }),
            insertFile(db, {
                userId: user.id,
                name: 'b.jpg',
                status: 'uploading',
            }),
            insertFile(db, {
                userId: user.id,
                name: 'c.jpg',
                status: 'deleted',
            }),
        ]);

        const [group] = await createFileRepo(db).findByUserGroupedByBatch(
            user.id,
            { includeHidden: true }
        );

        expect(group!.files.map((f) => f.name)).toEqual([
            'a.jpg',
            'b.jpg',
            'c.jpg',
        ]);
    });

    it('attaches each file’s active retrieval, and none for a lapsed one', async ({
        db,
        user,
    }) => {
        const add = (name: string) => insertFile(db, { userId: user.id, name });
        const [ready, lapsed, pending] = await Promise.all([
            add('ready.jpg'),
            add('lapsed.jpg'),
            add('pending.jpg'),
            add('plain.jpg'),
        ]);
        const expiresAt = future();
        await Promise.all([
            insertRetrieval(db, {
                userId: user.id,
                fileId: ready.id,
                status: 'ready',
                expiresAt,
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: lapsed.id,
                status: 'ready',
                expiresAt: past(),
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: pending.id,
                status: 'pending',
            }),
        ]);

        const [group] = await createFileRepo(db).findByUserGroupedByBatch(
            user.id
        );

        const byName = Object.fromEntries(
            group!.files.map((f) => [f.name, f.activeRetrieval])
        );
        expect(byName).toEqual({
            'ready.jpg': { status: 'ready', expiresAt },
            'lapsed.jpg': null,
            'pending.jpg': expect.objectContaining({ status: 'pending' }),
            'plain.jpg': null,
        });
    });
});

// Each write names its rows by id and nothing else scopes it, so the id
// filter is all that stands between one row and the whole table.
describe.concurrent('writes by id', () => {
    it('update writes the named file only, and returns undefined for a missing one', async ({
        db,
        user,
    }) => {
        const repo = createFileRepo(db);
        const [target, bystander] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);

        expect(
            await repo.update(target.id, { name: 'renamed.pdf' })
        ).toMatchObject({ id: target.id, name: 'renamed.pdf' });
        expect(await repo.findById(bystander.id)).toEqual(bystander);
        expect(
            await repo.update(crypto.randomUUID(), { name: 'x.pdf' })
        ).toBeUndefined();
    });

    it('delete removes the named file only, and returns undefined for a missing one', async ({
        db,
        user,
    }) => {
        const repo = createFileRepo(db);
        const [target, bystander] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);

        expect((await repo.delete(target.id))?.id).toBe(target.id);
        expect(await repo.findById(target.id)).toBeUndefined();
        expect(await repo.findById(bystander.id)).toEqual(bystander);
        expect(await repo.delete(crypto.randomUUID())).toBeUndefined();
    });

    it('softDeleteMany deletes the named files only', async ({ db, user }) => {
        const repo = createFileRepo(db);
        const [target, bystander] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);

        const deleted = await repo.softDeleteMany([target.id]);

        expect(deleted.map((f) => [f.id, f.status])).toEqual([
            [target.id, 'deleted'],
        ]);
        expect(await repo.findById(bystander.id)).toEqual(bystander);
    });
});

// Both scans are global, across every user. The dev database is shared, so
// the rows here are dated where no real row is: counts are taken over windows
// in the 1800s and 1900s (and rows updated after 2100), and the latest
// thumbnail is one updated in 2100.
//
// Runs of this file also overlap: Stryker's workers share one database, and so
// can engineers on dev. A fixed window would count the other run's rows too,
// so each count test dates its rows from a random slot of its own. The latest
// thumbnail test keeps its rows in a transaction it rolls back.
const DAY_MS = 24 * 60 * 60 * 1000;
const randomSlot = () => Math.floor(Math.random() * 10_000);
const daysAfter = (date: Date, days: number) =>
    new Date(date.getTime() + days * DAY_MS);

describe.concurrent('health-check scans (#409)', () => {
    // A file keyed the way the upload services key it, the only kind the
    // thumbnail count looks at.
    const insertUploadedFile = async (
        db: Parameters<typeof insertFile>[0],
        userId: string,
        extra: Parameters<typeof insertFile>[1]
    ) => {
        const batch = await insertUploadBatch(db, { userId });
        const id = crypto.randomUUID();
        const name = 'photo.jpg';
        return insertFile(db, {
            id,
            userId,
            batchId: batch.id,
            name,
            s3Key: originalKey({ userId, batchId: batch.id, id, name }),
            ...extra,
        });
    };

    it('countThumbnailStatuses counts visible, really-uploaded files by thumbnail status', async ({
        db,
        user,
    }) => {
        // A one-day window; slots are three days apart, so another run's rows
        // (half a day before its window to a day after) never reach this one.
        const windowStart = daysAfter(
            new Date('1900-01-01T00:00:00Z'),
            3 * randomSlot()
        );
        const inWindow = daysAfter(windowStart, 0.5);
        const realUpload = (extra: Parameters<typeof insertFile>[1]) =>
            insertUploadedFile(db, user.id, { createdAt: inWindow, ...extra });
        const seededId = crypto.randomUUID();
        await Promise.all([
            realUpload({ thumbnailStatus: 'ready' }),
            realUpload({ thumbnailStatus: 'ready' }),
            realUpload({ thumbnailStatus: 'failed_cold' }),
            // Not yet confirmed: hidden.
            realUpload({ thumbnailStatus: 'ready', status: 'uploading' }),
            // Outside the window, on either side.
            realUpload({
                thumbnailStatus: 'skipped',
                createdAt: daysAfter(windowStart, -0.5),
            }),
            realUpload({
                thumbnailStatus: 'failed',
                createdAt: daysAfter(windowStart, 1),
            }),
            // Seeded directly, never enqueued: keyed `<userId>/<fileId>`.
            insertFile(db, {
                userId: user.id,
                thumbnailStatus: 'pending',
                createdAt: inWindow,
            }),
            // A seed key with the file id third, like an upload's: only the
            // key's first segment, which isn't the owner, keeps it out.
            insertFile(db, {
                id: seededId,
                userId: user.id,
                s3Key: `seed/${user.id}/${seededId}`,
                thumbnailStatus: 'ready',
                createdAt: inWindow,
            }),
        ]);

        const counts = await createFileRepo(db).countThumbnailStatuses({
            createdAfter: windowStart,
            createdBefore: daysAfter(windowStart, 1),
        });

        expect(counts).toEqual({
            pending: 0,
            ready: 2,
            failed: 0,
            failed_cold: 1,
            skipped: 0,
        });
    });

    // The failed_cold digest's call: a cohort start and a recent-activity
    // cutoff, no end. Only rows updated after 2100 pass the cutoff, so no real
    // row is counted. The later a run's cohort starts, the earlier its cutoff
    // falls, so another run's rows are either created before this cohort or
    // updated before this cutoff.
    it('countThumbnailStatuses with updatedAfter counts only files updated since then', async ({
        db,
        user,
    }) => {
        const slot = randomSlot();
        const cohortStart = daysAfter(
            new Date('1800-01-01T00:00:00Z'),
            3 * slot
        );
        const updatedAfter = daysAfter(
            new Date('2200-01-01T00:00:00Z'),
            -3 * slot
        );
        const realUpload = (extra: Parameters<typeof insertFile>[1]) =>
            insertUploadedFile(db, user.id, {
                thumbnailStatus: 'failed_cold',
                createdAt: daysAfter(cohortStart, 0.5),
                ...extra,
            });
        await Promise.all([
            realUpload({ updatedAt: daysAfter(updatedAfter, 0.5) }),
            realUpload({ updatedAt: daysAfter(updatedAfter, -0.5) }),
            // Recently updated, but from before the cohort.
            realUpload({
                createdAt: daysAfter(cohortStart, -0.5),
                updatedAt: daysAfter(updatedAfter, 0.5),
            }),
        ]);

        const counts = await createFileRepo(db).countThumbnailStatuses({
            createdAfter: cohortStart,
            updatedAfter,
        });

        expect(counts).toEqual({
            pending: 0,
            ready: 0,
            failed: 0,
            failed_cold: 1,
            skipped: 0,
        });
    });

    // Another run's rows would carry the same 2100 dates, and there is no
    // window to move: the query wants the newest row in the table. So they
    // are seeded where no other run can see them.
    it('findLatestReadyThumbnail picks the most recently updated visible ready thumbnail', ({
        db,
        user,
    }) =>
        inRolledBackTransaction(db, async (tx) => {
            const at = (day: number) => new Date(Date.UTC(2100, 0, day));
            // Inserted first, so it's the row found first without the
            // newest-first sort, and the oldest one with it reversed: on an
            // empty database neither can pass as `latest`.
            await insertFile(tx, {
                userId: user.id,
                thumbnailStatus: 'ready',
                updatedAt: at(1),
            });
            const latest = await insertFile(tx, {
                userId: user.id,
                thumbnailStatus: 'ready',
                updatedAt: at(2),
            });
            await insertFile(tx, {
                userId: user.id,
                thumbnailStatus: 'ready',
                status: 'deleted',
                updatedAt: at(3),
            });
            await insertFile(tx, {
                userId: user.id,
                thumbnailStatus: 'pending',
                updatedAt: at(4),
            });

            expect(await createFileRepo(tx).findLatestReadyThumbnail()).toEqual(
                { id: latest.id, userId: user.id }
            );
        }));
});
