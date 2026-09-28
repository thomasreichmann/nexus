import { it, expect, describe } from '../test-db/integration';
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
        const [live, alreadyDeleted, theirs] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, {
                userId: user.id,
                status: 'deleted',
                deletedAt: LONG_AGO,
            }),
            insertFile(db, { userId: stranger.id }),
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

    it('findByUser sorts by the chosen column and pages through it', async ({
        db,
        user,
    }) => {
        const repo = createFileRepo(db);
        const base = Date.now();
        const [c, a, b] = await Promise.all(
            [
                { name: 'c.pdf', size: 300 },
                { name: 'a.pdf', size: 100 },
                { name: 'b.pdf', size: 200 },
            ].map((f, i) =>
                insertFile(db, {
                    userId: user.id,
                    ...f,
                    createdAt: new Date(base - i * 1000),
                })
            )
        );
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
        ).toEqual([b.name, c.name]);
        // Default: newest upload first.
        expect(
            names(await repo.findByUser(user.id, { limit: 2, offset: 0 }))
        ).toEqual([c.name, a.name]);
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
        await Promise.all([
            add('b.jpg', newer.id),
            add('a.jpg', newer.id),
            add('hidden.jpg', newer.id, { status: 'uploading' }),
            add('IMG_10.JPG', older.id),
            add('IMG_9.JPG', older.id),
            add('f.jpg', null),
            add('e.jpg', null),
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

describe.concurrent('writes by id', () => {
    it('update, delete and softDeleteMany touch only the rows they name', async ({
        db,
        user,
    }) => {
        const repo = createFileRepo(db);
        const [renamed, removed, softDeleted, bystander] = await Promise.all(
            Array.from({ length: 4 }, () => insertFile(db, { userId: user.id }))
        );

        expect(
            await repo.update(renamed.id, { name: 'renamed.pdf' })
        ).toMatchObject({ id: renamed.id, name: 'renamed.pdf' });
        expect((await repo.delete(removed.id))?.id).toBe(removed.id);
        expect(
            (await repo.softDeleteMany([softDeleted.id])).map((f) => [
                f.id,
                f.status,
            ])
        ).toEqual([[softDeleted.id, 'deleted']]);

        expect(await repo.findById(removed.id)).toBeUndefined();
        expect(await repo.findById(bystander.id)).toEqual(bystander);
        expect(
            await repo.update(crypto.randomUUID(), { name: 'x.pdf' })
        ).toBeUndefined();
        expect(await repo.delete(crypto.randomUUID())).toBeUndefined();
    });
});

// Both scans are global, across every user. The dev database is shared, so
// the rows here are dated where no real row is: counts are taken over a
// window in 1990, and the latest thumbnail is one updated in 2100.
describe.concurrent('health-check scans (#409)', () => {
    it('countThumbnailStatuses counts visible, really-uploaded files by thumbnail status', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const inWindow = new Date('1990-01-01T12:00:00Z');
        const realUpload = (extra: Parameters<typeof insertFile>[1]) => {
            const id = crypto.randomUUID();
            const name = 'photo.jpg';
            return insertFile(db, {
                id,
                userId: user.id,
                batchId: batch.id,
                name,
                s3Key: originalKey({
                    userId: user.id,
                    batchId: batch.id,
                    id,
                    name,
                }),
                createdAt: inWindow,
                ...extra,
            });
        };
        await Promise.all([
            realUpload({ thumbnailStatus: 'ready' }),
            realUpload({ thumbnailStatus: 'ready' }),
            realUpload({ thumbnailStatus: 'failed_cold' }),
            // Not yet confirmed: hidden.
            realUpload({ thumbnailStatus: 'ready', status: 'uploading' }),
            // Outside the window.
            realUpload({
                thumbnailStatus: 'failed',
                createdAt: new Date('1990-01-03T00:00:00Z'),
            }),
            // Seeded directly, never enqueued: keyed `<userId>/<fileId>`.
            insertFile(db, {
                userId: user.id,
                thumbnailStatus: 'pending',
                createdAt: inWindow,
            }),
        ]);

        const counts = await createFileRepo(db).countThumbnailStatuses({
            createdAfter: new Date('1990-01-01T00:00:00Z'),
            createdBefore: new Date('1990-01-02T00:00:00Z'),
        });

        expect(counts).toEqual({
            pending: 0,
            ready: 2,
            failed: 0,
            failed_cold: 1,
            skipped: 0,
        });
    });

    it('findLatestReadyThumbnail picks the most recently updated visible ready thumbnail', async ({
        db,
        user,
    }) => {
        const at = (day: number) => new Date(Date.UTC(2100, 0, day));
        const [latest] = await Promise.all([
            insertFile(db, {
                userId: user.id,
                thumbnailStatus: 'ready',
                updatedAt: at(1),
            }),
            insertFile(db, {
                userId: user.id,
                thumbnailStatus: 'ready',
                status: 'deleted',
                updatedAt: at(2),
            }),
            insertFile(db, {
                userId: user.id,
                thumbnailStatus: 'pending',
                updatedAt: at(3),
            }),
        ]);

        expect(await createFileRepo(db).findLatestReadyThumbnail()).toEqual({
            id: latest.id,
            userId: user.id,
        });
    });
});
