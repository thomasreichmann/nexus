import { vi } from 'vitest';
import {
    it,
    expect,
    describe,
    afterEach,
    beforeEach,
} from '../test-db/integration';
import { insertFile, insertRetrieval, insertUploadBatch } from '../test-db';
import {
    LIFECYCLE_TRANSITION_LAG_HOURS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '../objectState';
import { createLibraryRepo, type BatchFilesPage } from './library';
import type { DB } from '../connection';
import type { File } from './files';

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR_MS);

const names = (page: { files: { name: string }[] }) =>
    page.files.map((f) => f.name);

// Each name gets its own upload time, in the order given: the order a batch's
// rows are inserted is never the order it lists them in.
async function insertNamed(
    db: DB,
    userId: string,
    batchId: string | null,
    fileNames: string[],
    extra: Partial<File> = {}
): Promise<File[]> {
    return Promise.all(
        fileNames.map((name, i) =>
            insertFile(db, {
                userId,
                batchId,
                name,
                createdAt: hoursAgo(fileNames.length - i),
                ...extra,
            })
        )
    );
}

describe.concurrent('listBatchSummaries', () => {
    it('lists the user’s batches holding a visible file, newest first, with the legacy group last', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [newest, older, emptied, theirs] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'Newest' }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Older',
                createdAt: hoursAgo(2),
            }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Emptied',
                createdAt: hoursAgo(1),
            }),
            insertUploadBatch(db, { userId: stranger.id, name: 'Theirs' }),
        ]);
        await Promise.all([
            insertFile(db, { userId: user.id, batchId: newest.id, size: 100 }),
            insertFile(db, { userId: user.id, batchId: newest.id, size: 200 }),
            // Hidden: mid-upload, and deleted.
            insertFile(db, {
                userId: user.id,
                batchId: newest.id,
                size: 400,
                status: 'uploading',
            }),
            insertFile(db, {
                userId: user.id,
                batchId: newest.id,
                size: 800,
                status: 'deleted',
            }),
            // Nothing in the schema stops a row pointing at someone else's
            // batch; only the file's own owner filter keeps it out.
            insertFile(db, {
                userId: stranger.id,
                batchId: newest.id,
                size: 1600,
            }),
            insertFile(db, { userId: user.id, batchId: older.id, size: 50 }),
            insertFile(db, {
                userId: user.id,
                batchId: emptied.id,
                status: 'deleted',
            }),
            insertFile(db, { userId: user.id, size: 25 }),
            // A legacy file still uploading: the group's count leaves it out.
            insertFile(db, {
                userId: user.id,
                size: 3200,
                status: 'uploading',
            }),
            insertFile(db, { userId: stranger.id, batchId: theirs.id }),
            // The user's own file under someone else's batch: only the
            // batch's owner filter keeps that batch off the user's list.
            insertFile(db, { userId: user.id, batchId: theirs.id }),
            insertFile(db, { userId: stranger.id }),
        ]);
        // The user's batch holding nothing of theirs: only the file owner
        // filter keeps it out.
        const squatted = await insertUploadBatch(db, {
            userId: user.id,
            name: 'Squatted',
        });
        await insertFile(db, { userId: stranger.id, batchId: squatted.id });
        const repo = createLibraryRepo(db);

        const page = await repo.listBatchSummaries(user.id, { limit: 12 });

        expect(
            page.batches.map((b) => [
                b.batchId,
                b.name,
                b.fileCount,
                b.totalBytes,
            ])
        ).toEqual([
            [newest.id, 'Newest', 2, 300],
            [older.id, 'Older', 1, 50],
            [null, null, 1, 25],
        ]);
        expect(page.nextCursor).toBeNull();
        expect(await repo.countBatches(user.id)).toBe(3);
    });

    it('pages by keyset without skipping or repeating a batch, Ungrouped on the last page only', async ({
        db,
        user,
    }) => {
        const sameTime = hoursAgo(3);
        // Six batches, three to a page. Two were created in the same instant
        // and the first page ends between them: a cursor on time alone would
        // drop the second. The second page is exactly full, so it's the last
        // one only because nothing comes after it.
        const batches = await Promise.all([
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(1) }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(2) }),
            insertUploadBatch(db, { userId: user.id, createdAt: sameTime }),
            insertUploadBatch(db, { userId: user.id, createdAt: sameTime }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(4) }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(5) }),
        ]);
        await Promise.all([
            ...batches.map((b) =>
                insertFile(db, { userId: user.id, batchId: b.id })
            ),
            insertFile(db, { userId: user.id }),
        ]);
        const repo = createLibraryRepo(db);

        const seen: (string | null)[][] = [];
        let cursor: string | null = null;
        do {
            const page = await repo.listBatchSummaries(user.id, {
                limit: 3,
                cursor,
            });
            seen.push(page.batches.map((b) => b.batchId));
            cursor = page.nextCursor;
        } while (cursor && seen.length < 10);

        const [first, second] = seen;
        expect(seen).toHaveLength(2);
        // Every batch once and Ungrouped once, at the very end: a page is
        // its limit, never the extra row read to see if there's more.
        expect(seen.map((page) => page.length)).toEqual([3, 4]);
        expect(new Set(seen.flat()).size).toBe(7);
        expect(first!.slice(0, 2)).toEqual([batches[0]!.id, batches[1]!.id]);
        // Which of the tied pair comes first is the database's text order;
        // that each comes once, either side of the page break, is the keyset's.
        expect([first![2], second![0]].sort()).toEqual(
            [batches[2]!.id, batches[3]!.id].sort()
        );
        expect(second!.slice(1)).toEqual([
            batches[4]!.id,
            batches[5]!.id,
            null,
        ]);
    });

    // A page's batches are picked before they're summed, so one that would
    // sum to nothing must not take a place on it: the page would come up
    // short and say it's the last.
    it('fills a page with batches holding a visible file, past newer ones holding none', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [hollow, ...shoots] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'Hollow' }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(1) }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(2) }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(3) }),
        ]);
        await Promise.all([
            // The newest batch holds files, none of them the user's to see.
            insertFile(db, {
                userId: user.id,
                batchId: hollow.id,
                status: 'deleted',
            }),
            insertFile(db, { userId: stranger.id, batchId: hollow.id }),
            ...shoots.map((b) =>
                insertFile(db, { userId: user.id, batchId: b.id })
            ),
        ]);

        const page = await createLibraryRepo(db).listBatchSummaries(user.id, {
            limit: 2,
        });

        expect(page.batches.map((b) => b.batchId)).toEqual([
            shoots[0]!.id,
            shoots[1]!.id,
        ]);
        expect(page.nextCursor).toBe(shoots[1]!.id);
    });

    it('pages nothing of the user’s from another user’s batch as a cursor', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [theirs, mine] = await Promise.all([
            insertUploadBatch(db, { userId: stranger.id }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(1) }),
        ]);
        await Promise.all([
            insertFile(db, { userId: stranger.id, batchId: theirs.id }),
            insertFile(db, { userId: user.id, batchId: mine.id }),
        ]);

        const page = await createLibraryRepo(db).listBatchSummaries(user.id, {
            limit: 12,
            cursor: theirs.id,
        });

        // Without the cursor's owner filter, the stranger's batch would mark
        // a place, and the user's older batch would come after it.
        expect(page.batches).toEqual([]);
    });

    it('counts the batches, and Ungrouped only for the user’s own visible files with no batch', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const batch = await insertUploadBatch(db, { userId: user.id });
        await Promise.all([
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                name: 'a.jpg',
            }),
            insertFile(db, { userId: user.id, status: 'uploading' }),
            insertFile(db, { userId: stranger.id }),
        ]);
        const repo = createLibraryRepo(db);

        expect(await repo.countBatches(user.id)).toBe(1);

        await insertFile(db, { userId: user.id, name: 'legacy.pdf' });
        expect(await repo.countBatches(user.id)).toBe(2);
        // A search that only the batch's file matches leaves Ungrouped out.
        expect(await repo.countBatches(user.id, { search: 'a.jpg' })).toBe(1);
    });

    it('summarizes restore status from the active retrievals: in flight, ready with the earliest expiry, and archived ones probably cold', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const old = hoursAgo(LIFECYCLE_TRANSITION_LAG_HOURS + 1);
        const big = LIFECYCLE_TRANSITION_MIN_BYTES + 1;
        const add = (extra: Partial<File> = {}) =>
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                size: big,
                createdAt: old,
                ...extra,
            });
        const [queued, restoring, readySoon, readyLater, lapsed, readied] =
            await Promise.all([
                add(),
                add(),
                add(),
                add(),
                add(),
                // Still marked restoring, but its retrieval is ready: the
                // retrieval wins, as it does on the tile.
                add({ status: 'restoring' }),
                // Marked restoring with no active retrieval: still in flight.
                add({ status: 'restoring' }),
                // Archived and cold: big and past the lifecycle's lag.
                add(),
                // Archived, but at the size floor, or too young: not cold.
                add({ size: LIFECYCLE_TRANSITION_MIN_BYTES }),
                add({
                    createdAt: hoursAgo(LIFECYCLE_TRANSITION_LAG_HOURS - 1),
                }),
            ]);
        const soon = hoursFromNow(1);
        await Promise.all([
            insertRetrieval(db, {
                userId: user.id,
                fileId: queued!.id,
                status: 'pending',
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: restoring!.id,
                status: 'in_progress',
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: readySoon!.id,
                status: 'ready',
                expiresAt: soon,
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: readyLater!.id,
                status: 'ready',
                expiresAt: hoursFromNow(5),
            }),
            // Lapsed: no longer active, so the file reads archived (and cold).
            insertRetrieval(db, {
                userId: user.id,
                fileId: lapsed!.id,
                status: 'ready',
                expiresAt: hoursAgo(1),
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: readied!.id,
                status: 'ready',
                expiresAt: hoursFromNow(3),
            }),
        ]);

        const {
            batches: [summary],
        } = await createLibraryRepo(db).listBatchSummaries(user.id, {
            limit: 12,
        });

        expect(summary).toMatchObject({
            fileCount: 10,
            restoringCount: 3,
            readyCount: 3,
            readyUntil: soon,
            archivedProbablyColdCount: 2,
        });
    });

    it('covers each batch with its thumbnailed files first, in natural order, filled from the rest, three at most', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [photos, mixed] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id, createdAt: hoursAgo(1) }),
        ]);
        await Promise.all([
            insertNamed(
                db,
                user.id,
                photos.id,
                ['IMG_10.JPG', 'IMG_9.JPG', 'IMG_2.JPG', 'IMG_1.JPG'],
                { thumbnailStatus: 'ready' }
            ),
            insertNamed(db, user.id, photos.id, ['a.pdf']),
            insertNamed(db, user.id, mixed.id, ['c.pdf', 'b.pdf', 'a.pdf']),
            insertNamed(db, user.id, mixed.id, ['z.jpg'], {
                thumbnailStatus: 'ready',
            }),
            // Another user's thumbnail under the user's batch is no cover of
            // theirs, however first it would sort.
            insertNamed(db, stranger.id, photos.id, ['AAA.JPG'], {
                thumbnailStatus: 'ready',
            }),
            // A ready thumbnail on a hidden row is still no cover.
            insertNamed(db, user.id, mixed.id, ['hidden.jpg'], {
                thumbnailStatus: 'ready',
                status: 'uploading',
            }),
        ]);

        const { batches } = await createLibraryRepo(db).listBatchSummaries(
            user.id,
            { limit: 12 }
        );

        expect(batches.map((b) => b.coverFiles.map((f) => f.name))).toEqual([
            ['IMG_1.JPG', 'IMG_2.JPG', 'IMG_9.JPG'],
            ['z.jpg', 'a.pdf', 'b.pdf'],
        ]);
    });

    it('searches batch names, file names and folders: a name match shows whole, a file match shows its matches', async ({
        db,
        user,
    }) => {
        const [wedding, studio, camera, unrelated] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'Silva Wedding' }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Studio',
                createdAt: hoursAgo(1),
            }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Camera',
                createdAt: hoursAgo(2),
            }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Unrelated',
                createdAt: hoursAgo(3),
            }),
        ]);
        await Promise.all([
            insertNamed(db, user.id, wedding.id, ['a.jpg', 'b.jpg']),
            insertNamed(db, user.id, studio.id, [
                'other.jpg',
                'SILVA-portrait.jpg',
            ]),
            insertNamed(db, user.id, camera.id, ['IMG_1.JPG'], {
                subpath: 'Silva/104CANON',
            }),
            insertNamed(db, user.id, camera.id, ['IMG_2.JPG']),
            insertNamed(db, user.id, unrelated.id, ['x.jpg']),
            insertNamed(db, user.id, null, ['silva-legacy.pdf', 'plain.pdf']),
        ]);
        const repo = createLibraryRepo(db);

        const { batches } = await repo.listBatchSummaries(user.id, {
            limit: 12,
            search: 'silva',
        });

        expect(
            batches.map((b) => [
                b.name,
                b.fileCount,
                b.matchCount,
                b.coverFiles.map((f) => f.name),
            ])
        ).toEqual([
            ['Silva Wedding', 2, null, ['a.jpg', 'b.jpg']],
            ['Studio', 2, 1, ['SILVA-portrait.jpg']],
            ['Camera', 2, 1, ['IMG_1.JPG']],
            [null, 2, 1, ['silva-legacy.pdf']],
        ]);
        expect(await repo.countBatches(user.id, { search: 'silva' })).toBe(4);
        expect(await repo.countBatches(user.id)).toBe(5);
    });

    it('leaves Ungrouped out of a search none of its files match', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, {
            userId: user.id,
            name: 'Silva Wedding',
        });
        await Promise.all([
            insertNamed(db, user.id, batch.id, ['a.jpg']),
            insertNamed(db, user.id, null, ['silva-legacy.pdf']),
        ]);

        const { batches } = await createLibraryRepo(db).listBatchSummaries(
            user.id,
            { limit: 12, search: 'wedding' }
        );

        expect(batches.map((b) => b.name)).toEqual(['Silva Wedding']);
    });

    it('searches for the term itself: trimmed, with LIKE wildcards taken literally', async ({
        db,
        user,
    }) => {
        const [literal, wildcard] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'Literal' }),
            insertUploadBatch(db, {
                userId: user.id,
                name: 'Wildcard',
                createdAt: hoursAgo(1),
            }),
        ]);
        await Promise.all([
            insertNamed(db, user.id, literal.id, ['foo_bar.txt']),
            // Matches `foo_bar` only if `_` is read as "any character".
            insertNamed(db, user.id, wildcard.id, ['fooXbar.txt']),
        ]);
        const repo = createLibraryRepo(db);
        const search = async (term: string) =>
            (
                await repo.listBatchSummaries(user.id, {
                    limit: 12,
                    search: term,
                })
            ).batches.map((b) => [b.name, b.matchCount]);

        expect(await search('foo_bar')).toEqual([['Literal', 1]]);
        expect(await search('  foo_bar ')).toEqual([['Literal', 1]]);
    });
});

describe.concurrent('findBatch', () => {
    it('opens a batch with its folders in natural order, the top level first', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const batch = await insertUploadBatch(db, { userId: user.id });
        const add = (subpath: string | null, count: number) =>
            insertNamed(
                db,
                user.id,
                batch.id,
                Array.from({ length: count }, (_, i) => `IMG_${i}.JPG`),
                { subpath }
            );
        await Promise.all([
            add('1000CANON', 1),
            add('105CANON', 1),
            add('104CANON', 2),
            add(null, 2),
            // A folder whose only file is hidden isn't one.
            insertNamed(db, user.id, batch.id, ['gone.jpg'], {
                subpath: 'Trash',
                status: 'deleted',
            }),
            // Nor is one only another user's file sits in.
            insertNamed(db, stranger.id, batch.id, ['theirs.jpg'], {
                subpath: 'Theirs',
            }),
        ]);

        const opened = await createLibraryRepo(db).findBatch(user.id, batch.id);

        expect(opened).toMatchObject({ batchId: batch.id, fileCount: 6 });
        expect(opened?.folders).toEqual([
            { subpath: null, fileCount: 2, matchCount: null },
            { subpath: '104CANON', fileCount: 2, matchCount: null },
            { subpath: '105CANON', fileCount: 1, matchCount: null },
            { subpath: '1000CANON', fileCount: 1, matchCount: null },
        ]);
    });

    it('leaves a batch whose files all sit in one place flat', async ({
        db,
        user,
    }) => {
        const [nested, top] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        await Promise.all([
            insertNamed(db, user.id, nested.id, ['a.jpg', 'b.jpg'], {
                subpath: '104CANON',
            }),
            insertNamed(db, user.id, top.id, ['a.jpg', 'b.jpg']),
        ]);
        const repo = createLibraryRepo(db);

        expect((await repo.findBatch(user.id, nested.id))?.folders).toBeNull();
        expect((await repo.findBatch(user.id, top.id))?.folders).toBeNull();
    });

    it('finds nothing for another user’s batch, an emptied one, or an empty Ungrouped', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [theirs, emptied] = await Promise.all([
            insertUploadBatch(db, { userId: stranger.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        await Promise.all([
            insertFile(db, { userId: stranger.id, batchId: theirs.id }),
            // Even holding one of the user's own files, the batch is theirs.
            insertFile(db, { userId: user.id, batchId: theirs.id }),
            insertFile(db, {
                userId: user.id,
                batchId: emptied.id,
                status: 'deleted',
            }),
            insertFile(db, { userId: stranger.id }),
        ]);
        const repo = createLibraryRepo(db);

        expect(await repo.findBatch(user.id, theirs.id)).toBeUndefined();
        expect(await repo.findBatch(user.id, emptied.id)).toBeUndefined();
        expect(await repo.findBatch(user.id, null)).toBeUndefined();
    });

    it('opens the batch asked for, and the legacy Ungrouped group by no id', async ({
        db,
        user,
    }) => {
        const [a, b] = await Promise.all([
            insertUploadBatch(db, { userId: user.id, name: 'A' }),
            insertUploadBatch(db, { userId: user.id, name: 'B' }),
        ]);
        await Promise.all([
            insertNamed(db, user.id, a.id, ['a.jpg']),
            insertNamed(db, user.id, b.id, ['b1.jpg', 'b2.jpg']),
            insertNamed(db, user.id, null, [
                'old-1.pdf',
                'old-2.pdf',
                'old-3.pdf',
            ]),
        ]);
        const repo = createLibraryRepo(db);
        const open = async (batchId: string | null) => {
            const batch = await repo.findBatch(user.id, batchId);
            return [batch?.batchId, batch?.name, batch?.fileCount];
        };

        expect(await open(a.id)).toEqual([a.id, 'A', 1]);
        expect(await open(b.id)).toEqual([b.id, 'B', 2]);
        expect(await open(null)).toEqual([null, null, 3]);
    });

    // The name wins: a batch found by its name shows whole, even when some
    // of its files match the term too.
    it('opens a batch whose name and files both match the search whole', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, {
            userId: user.id,
            name: 'Shoot',
        });
        await Promise.all([
            insertNamed(db, user.id, batch.id, ['shoot-notes.txt']),
            insertNamed(db, user.id, batch.id, ['IMG_1.JPG'], {
                subpath: '104CANON',
            }),
        ]);

        const opened = await createLibraryRepo(db).findBatch(
            user.id,
            batch.id,
            { search: 'shoot' }
        );

        expect(opened?.matchCount).toBeNull();
        expect(opened?.folders).toEqual([
            { subpath: null, fileCount: 1, matchCount: null },
            { subpath: '104CANON', fileCount: 1, matchCount: null },
        ]);
    });

    it('searching a batch for its files keeps the folders holding a match; a search it doesn’t match shows it whole', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, {
            userId: user.id,
            name: 'Shoot',
        });
        await Promise.all([
            insertNamed(
                db,
                user.id,
                batch.id,
                ['IMG_0001.JPG', 'IMG_0002.JPG'],
                {
                    subpath: '104CANON',
                }
            ),
            insertNamed(db, user.id, batch.id, ['IMG_0001.JPG', 'DSC_9.NEF'], {
                subpath: '105CANON',
            }),
        ]);
        const repo = createLibraryRepo(db);
        const open = async (search: string) => {
            const found = await repo.findBatch(user.id, batch.id, { search });
            return { matchCount: found?.matchCount, folders: found?.folders };
        };
        const whole = {
            matchCount: null,
            folders: [
                { subpath: '104CANON', fileCount: 2, matchCount: null },
                { subpath: '105CANON', fileCount: 2, matchCount: null },
            ],
        };

        expect(await open('dsc')).toEqual({
            matchCount: 1,
            folders: [{ subpath: '105CANON', fileCount: 2, matchCount: 1 }],
        });
        expect(await open('104')).toEqual({
            matchCount: 2,
            folders: [{ subpath: '104CANON', fileCount: 2, matchCount: 2 }],
        });
        expect(await open('shoot')).toEqual(whole);
        expect(await open('nowhere')).toEqual(whole);
    });
});

describe.concurrent('listBatchFiles', () => {
    // Inserted in an order that is neither the natural one nor the plain
    // lexicographic one (where IMG_10 sorts before IMG_2).
    const SHUFFLED = [
        'IMG_10.JPG',
        'IMG_2.JPG',
        'img_3.jpg',
        'IMG_9.JPG',
        'IMG_1.JPG',
    ];
    const NATURAL = [
        'IMG_1.JPG',
        'IMG_2.JPG',
        'img_3.jpg',
        'IMG_9.JPG',
        'IMG_10.JPG',
    ];

    it('pages a batch’s visible files forward in natural order, each page saying where it sits', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [batch, other] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const files = await insertNamed(db, user.id, batch.id, SHUFFLED);
        await Promise.all([
            insertNamed(db, user.id, batch.id, ['IMG_5.JPG'], {
                status: 'uploading',
            }),
            insertNamed(db, user.id, other.id, ['IMG_4.JPG']),
            insertNamed(db, user.id, null, ['IMG_6.JPG']),
            insertNamed(db, stranger.id, batch.id, ['IMG_7.JPG']),
        ]);
        const idOf = (name: string) => files.find((f) => f.name === name)!.id;
        const repo = createLibraryRepo(db);
        const page = (cursor: string | null) =>
            repo.listBatchFiles(user.id, {
                batchId: batch.id,
                limit: 2,
                cursor,
            });

        const first = await page(null);
        const second = await page(first.nextCursor);
        const last = await page(second.nextCursor);

        expect([first, second, last].map(names)).toEqual([
            NATURAL.slice(0, 2),
            NATURAL.slice(2, 4),
            NATURAL.slice(4),
        ]);
        expect(
            [first, second, last].map(
                ({ startIndex, total, previousCursor }) => ({
                    startIndex,
                    total,
                    previousCursor,
                })
            )
        ).toEqual([
            { startIndex: 0, total: 5, previousCursor: null },
            { startIndex: 2, total: 5, previousCursor: idOf('img_3.jpg') },
            { startIndex: 4, total: 5, previousCursor: idOf('IMG_10.JPG') },
        ]);
        expect(first.nextCursor).toBe(idOf('img_3.jpg'));
        expect(last.nextCursor).toBeNull();
    });

    it('pages backward from a cursor, back to the start', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const [batch, other] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const [files] = await Promise.all([
            insertNamed(db, user.id, batch.id, SHUFFLED),
            // Files that sort first but aren't the batch's, or the user's:
            // a backward page past the scope would end on them.
            insertNamed(db, user.id, other.id, ['IMG_0.JPG']),
            insertNamed(db, stranger.id, batch.id, ['IMG_0.JPG']),
        ]);
        const idOf = (name: string) => files.find((f) => f.name === name)!.id;
        const repo = createLibraryRepo(db);
        const back = (cursor: string) =>
            repo.listBatchFiles(user.id, {
                batchId: batch.id,
                limit: 2,
                cursor,
                direction: 'backward',
            });

        const before = await back(idOf('IMG_9.JPG'));
        const start = await back(before.previousCursor!);

        expect(names(before)).toEqual(['IMG_2.JPG', 'img_3.jpg']);
        expect(before).toMatchObject({
            startIndex: 1,
            previousCursor: idOf('IMG_2.JPG'),
            nextCursor: idOf('IMG_9.JPG'),
        });
        expect(names(start)).toEqual(['IMG_1.JPG']);
        expect(start).toMatchObject({ startIndex: 0, previousCursor: null });

        // Exactly a page's worth before the cursor: that page is the first.
        const exact = await back(idOf('img_3.jpg'));
        expect(names(exact)).toEqual(['IMG_1.JPG', 'IMG_2.JPG']);
        expect(exact.previousCursor).toBeNull();

        // Back from the very first file: nothing, and nowhere further.
        const none = await back(idOf('IMG_1.JPG'));
        expect(none).toMatchObject({
            files: [],
            startIndex: 0,
            previousCursor: null,
        });
    });

    // A deep link's page, every file on it deleted since `locate` found it:
    // the page is empty but still knows where it is, and pages back.
    it('pages back from a cursor whose files have all gone since', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const [kept, [gone]] = await Promise.all([
            insertNamed(db, user.id, batch.id, NATURAL.slice(0, 4)),
            insertNamed(db, user.id, batch.id, ['IMG_10.JPG'], {
                status: 'deleted',
            }),
        ]);
        const repo = createLibraryRepo(db);

        const landed = await repo.listBatchFiles(user.id, {
            batchId: batch.id,
            limit: 2,
            cursor: gone!.id,
        });
        const back = await repo.listBatchFiles(user.id, {
            batchId: batch.id,
            limit: 2,
            cursor: landed.previousCursor!,
            direction: 'backward',
        });

        expect(landed).toMatchObject({
            files: [],
            startIndex: 4,
            total: 4,
            nextCursor: null,
            previousCursor: gone!.id,
        });
        expect(names(back)).toEqual(['img_3.jpg', 'IMG_9.JPG']);
        expect(back.previousCursor).toBe(kept[2]!.id);
    });

    it('opens mid-batch from a cursor, saying where the page sits and how to page back', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const files = await insertNamed(db, user.id, batch.id, SHUFFLED);
        const idOf = (name: string) => files.find((f) => f.name === name)!.id;

        const landed = await createLibraryRepo(db).listBatchFiles(user.id, {
            batchId: batch.id,
            limit: 2,
            cursor: idOf('img_3.jpg'),
        });

        expect(names(landed)).toEqual(['img_3.jpg', 'IMG_9.JPG']);
        expect(landed).toMatchObject({
            startIndex: 2,
            previousCursor: idOf('img_3.jpg'),
            nextCursor: idOf('IMG_10.JPG'),
        });
    });

    it('never skips or repeats a file whose name and upload time tie another’s', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const sameTime = hoursAgo(1);
        await Promise.all(
            ['a.jpg', 'a.jpg', 'a.jpg', 'b.jpg'].map((name) =>
                insertFile(db, {
                    userId: user.id,
                    batchId: batch.id,
                    name,
                    createdAt: sameTime,
                })
            )
        );
        const repo = createLibraryRepo(db);

        const ids: string[] = [];
        let cursor: string | null = null;
        do {
            const page: BatchFilesPage = await repo.listBatchFiles(user.id, {
                batchId: batch.id,
                limit: 1,
                cursor,
            });
            ids.push(...page.files.map((f) => f.id));
            cursor = page.nextCursor;
        } while (cursor && ids.length < 10);

        expect(ids).toHaveLength(4);
        expect(new Set(ids).size).toBe(4);
    });

    it('breaks a name tie by the older upload, and sorts a zero-padded number by its value', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const [later, earlier] = await Promise.all([
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                name: 'IMG_0001.JPG',
                createdAt: hoursAgo(1),
            }),
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                name: 'IMG_0001.JPG',
                createdAt: hoursAgo(2),
            }),
            // Byte order puts IMG_0010 first ('0' < '9'); its value doesn't.
            insertNamed(db, user.id, batch.id, ['IMG_0010.JPG', 'IMG_9.JPG']),
        ]);

        const page = await createLibraryRepo(db).listBatchFiles(user.id, {
            batchId: batch.id,
            limit: 10,
        });

        expect(page.files.map((f) => f.id).slice(0, 2)).toEqual([
            earlier.id,
            later.id,
        ]);
        expect(names(page).slice(2)).toEqual(['IMG_9.JPG', 'IMG_0010.JPG']);
    });

    it('lists one folder, the top level, or the whole batch folder by folder', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        await Promise.all([
            insertNamed(db, user.id, batch.id, ['z-top.jpg']),
            insertNamed(db, user.id, batch.id, ['IMG_0002.JPG'], {
                subpath: '105CANON',
            }),
            insertNamed(db, user.id, batch.id, ['IMG_0001.JPG'], {
                subpath: '104CANON',
            }),
        ]);
        const repo = createLibraryRepo(db);
        const list = async (folder: string | null | undefined) =>
            (
                await repo.listBatchFiles(user.id, {
                    batchId: batch.id,
                    folder,
                    limit: 10,
                })
            ).files.map((f) => `${f.subpath ?? ''}/${f.name}`);

        expect(await list('104CANON')).toEqual(['104CANON/IMG_0001.JPG']);
        expect(await list(null)).toEqual(['/z-top.jpg']);
        expect(await list(undefined)).toEqual([
            '/z-top.jpg',
            '104CANON/IMG_0001.JPG',
            '105CANON/IMG_0002.JPG',
        ]);
    });

    it('narrows to the files matching a search by name or folder', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        await Promise.all([
            insertNamed(db, user.id, batch.id, [
                'a.jpg',
                'canon-notes.txt',
                'IMGX1.JPG',
            ]),
            insertNamed(db, user.id, batch.id, ['IMG_1.JPG'], {
                subpath: '104CANON',
            }),
        ]);
        const repo = createLibraryRepo(db);
        const search = async (term: string) =>
            names(
                await repo.listBatchFiles(user.id, {
                    batchId: batch.id,
                    search: term,
                    limit: 10,
                })
            );

        expect(await search('CANON')).toEqual(['canon-notes.txt', 'IMG_1.JPG']);
        expect(await search('a.jp')).toEqual(['a.jpg']);
        // `_` is a literal, not LIKE's "any character".
        expect(await search('IMG_1')).toEqual(['IMG_1.JPG']);
    });

    it('attaches each file’s active retrieval, and none for a lapsed one', async ({
        db,
        user,
    }) => {
        const [ready, lapsed, pending] = await insertNamed(db, user.id, null, [
            'ready.jpg',
            'lapsed.jpg',
            'pending.jpg',
            'plain.jpg',
        ]);
        const expiresAt = hoursFromNow(1);
        await Promise.all([
            insertRetrieval(db, {
                userId: user.id,
                fileId: ready!.id,
                status: 'ready',
                expiresAt,
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: lapsed!.id,
                status: 'ready',
                expiresAt: hoursAgo(1),
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: pending!.id,
                status: 'pending',
            }),
        ]);

        const { files } = await createLibraryRepo(db).listBatchFiles(user.id, {
            batchId: null,
            limit: 10,
        });

        expect(
            Object.fromEntries(files.map((f) => [f.name, f.activeRetrieval]))
        ).toEqual({
            'ready.jpg': { status: 'ready', expiresAt },
            'lapsed.jpg': null,
            'pending.jpg': expect.objectContaining({ status: 'pending' }),
            'plain.jpg': null,
        });
    });

    it('returns no storage key or owner for a file', async ({ db, user }) => {
        await insertFile(db, { userId: user.id });

        const {
            files: [file],
        } = await createLibraryRepo(db).listBatchFiles(user.id, {
            batchId: null,
            limit: 10,
        });

        expect(file).not.toHaveProperty('s3Key');
        expect(file).not.toHaveProperty('userId');
    });

    it('pages nothing from another user’s file as a cursor', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const batch = await insertUploadBatch(db, { userId: user.id });
        const [[theirs]] = await Promise.all([
            insertNamed(db, stranger.id, null, ['a.jpg']),
            insertNamed(db, user.id, batch.id, ['b.jpg', 'c.jpg']),
        ]);

        const page = await createLibraryRepo(db).listBatchFiles(user.id, {
            batchId: batch.id,
            limit: 10,
            cursor: theirs!.id,
        });

        expect(page.files).toEqual([]);
    });
});

describe.concurrent('locateFile', () => {
    it('finds the batch and folder of the user’s own visible file only', async ({
        db,
        user,
        createUser,
    }) => {
        const stranger = await createUser();
        const batch = await insertUploadBatch(db, { userId: user.id });
        const [mine, gone, theirs] = await Promise.all([
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                subpath: '104CANON',
            }),
            insertFile(db, {
                userId: user.id,
                batchId: batch.id,
                status: 'deleted',
            }),
            insertFile(db, { userId: stranger.id }),
        ]);
        const repo = createLibraryRepo(db);
        const locate = (fileId: string) =>
            repo.locateFile(user.id, fileId, { pageSize: 100 });

        expect(await locate(mine.id)).toEqual({
            batchId: batch.id,
            subpath: '104CANON',
            pageStartId: mine.id,
        });
        expect(await locate(gone.id)).toBeUndefined();
        expect(await locate(theirs.id)).toBeUndefined();
        // A hand-edited `?file=` is no id at all.
        expect(await locate('not-a-file')).toBeUndefined();
    });

    // IMG_9 is the fourth file of the five: with two to a page it sits on the
    // second page, which starts at img_3.
    it('starts the deep link at the page holding the file, counted across a flat batch', async ({
        db,
        user,
    }) => {
        const [batch, other] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const [files] = await Promise.all([
            insertNamed(db, user.id, batch.id, [
                'IMG_10.JPG',
                'IMG_2.JPG',
                'img_3.jpg',
                'IMG_9.JPG',
                'IMG_1.JPG',
            ]),
            // Sorts first, but in another batch: counted, it would shift the
            // pages by one.
            insertNamed(db, user.id, other.id, ['IMG_0.JPG']),
        ]);
        const idOf = (name: string) => files.find((f) => f.name === name)!.id;

        const located = await createLibraryRepo(db).locateFile(
            user.id,
            idOf('IMG_9.JPG'),
            { pageSize: 2 }
        );

        expect(located?.pageStartId).toBe(idOf('img_3.jpg'));
    });

    it('counts the deep link’s page within its own folder, in a batch with folders', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const [, folder] = await Promise.all([
            // Ahead of the folder in the batch's order, but not in it.
            insertNamed(db, user.id, batch.id, ['a.jpg', 'b.jpg', 'c.jpg']),
            insertNamed(
                db,
                user.id,
                batch.id,
                ['IMG_1.JPG', 'IMG_2.JPG', 'IMG_3.JPG'],
                {
                    subpath: '104CANON',
                }
            ),
        ]);
        const idOf = (name: string) => folder.find((f) => f.name === name)!.id;

        const located = await createLibraryRepo(db).locateFile(
            user.id,
            idOf('IMG_3.JPG'),
            { pageSize: 2 }
        );

        // Third in its folder: the folder's second page.
        expect(located).toEqual({
            batchId: batch.id,
            subpath: '104CANON',
            pageStartId: idOf('IMG_3.JPG'),
        });
    });
});

// The cold count's age cutoff, exactly at the edge, where its JS twin
// `isProbablyCold` (age >= the lag) says cold. Sequential, not concurrent:
// it freezes the clock (Date only, so the driver's timers still run).
describe('the probably-cold cutoff', () => {
    const NOW = new Date('2026-10-12T12:00:00.000Z');
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts a file exactly the lifecycle’s lag old as cold, and one a millisecond younger as not', async ({
        db,
        user,
    }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });
        const lagAgo = NOW.getTime() - LIFECYCLE_TRANSITION_LAG_HOURS * HOUR_MS;
        await Promise.all(
            [lagAgo, lagAgo + 1].map((created) =>
                insertFile(db, {
                    userId: user.id,
                    batchId: batch.id,
                    size: LIFECYCLE_TRANSITION_MIN_BYTES + 1,
                    createdAt: new Date(created),
                })
            )
        );

        const {
            batches: [summary],
        } = await createLibraryRepo(db).listBatchSummaries(user.id, {
            limit: 12,
        });

        expect(summary?.archivedProbablyColdCount).toBe(1);
    });
});
