import { it, expect, describe } from '../test-db/integration';
import { insertFile, insertRetrieval } from '../test-db';
import { createRetrievalRepo } from './retrievals';

const HOUR_MS = 60 * 60 * 1000;
const past = () => new Date(Date.now() - HOUR_MS);
const future = () => new Date(Date.now() + HOUR_MS);

describe.concurrent('retrievals repository', () => {
    // A `ready` row past `expiresAt` is expired by predicate, not by stored
    // status: nothing tells us when a restored copy lapses.
    it('active queries exclude lapsed rows but keep unexpired, event-less, and in-flight ones', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createRetrievalRepo(db);
        const [lapsedFile, unexpiredFile, noExpiryFile, pendingFile] =
            await Promise.all([
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
                insertFile(db, { userId: user.id }),
            ]);

        await insertRetrieval(db, {
            userId: user.id,
            fileId: lapsedFile.id,
            status: 'ready',
            expiresAt: past(),
        });
        const unexpired = await insertRetrieval(db, {
            userId: user.id,
            fileId: unexpiredFile.id,
            status: 'ready',
            expiresAt: future(),
        });
        // No expiresAt (e.g. a malformed restore-completed event): treated as
        // still active — better a stale entry than a download cut off early.
        const noExpiry = await insertRetrieval(db, {
            userId: user.id,
            fileId: noExpiryFile.id,
            status: 'ready',
            expiresAt: null,
        });
        const pending = await insertRetrieval(db, {
            userId: user.id,
            fileId: pendingFile.id,
            status: 'pending',
        });

        const fileIds = [
            lapsedFile.id,
            unexpiredFile.id,
            noExpiryFile.id,
            pendingFile.id,
        ];
        const byFileIds = await repo.findByFileIds(fileIds);
        expect(new Set(byFileIds.map((r) => r.id))).toEqual(
            new Set([unexpired.id, noExpiry.id, pending.id])
        );

        expect(await repo.findByFileId(lapsedFile.id)).toBeUndefined();

        // Another user's active row, which the ownership filter must exclude.
        const stranger = await createUser();
        await insertRetrieval(db, {
            userId: stranger.id,
            fileId: (await insertFile(db, { userId: stranger.id })).id,
            status: 'ready',
            expiresAt: future(),
        });

        const active = await repo.findActiveByUserWithFiles(user.id);
        expect(new Set(active.map((r) => r.id))).toEqual(
            new Set([unexpired.id, noExpiry.id, pending.id])
        );
    });

    it('findByFileId returns the file’s active retrieval, not a past one or another file’s', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRepo(db);
        const [file, otherFile] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);
        await Promise.all([
            insertRetrieval(db, {
                userId: user.id,
                fileId: file.id,
                status: 'expired',
            }),
            insertRetrieval(db, {
                userId: user.id,
                fileId: otherFile.id,
                status: 'pending',
            }),
        ]);
        const active = await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'in_progress',
        });

        expect((await repo.findByFileId(file.id))?.id).toBe(active.id);
    });

    // The race-reconciliation lookup: whatever the status, the newest row.
    it('findLatestByFileId returns the file’s newest retrieval, active or not', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRepo(db);
        const [file, otherFile] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);
        const created = (hoursAgo: number) =>
            new Date(Date.now() - hoursAgo * HOUR_MS);
        // Oldest inserted first: without the sort, it's the row found first.
        await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'expired',
            createdAt: created(2),
        });
        const latest = await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'failed',
            createdAt: created(1),
        });
        await insertRetrieval(db, {
            userId: user.id,
            fileId: otherFile.id,
            status: 'pending',
            createdAt: created(0),
        });

        expect((await repo.findLatestByFileId(file.id))?.id).toBe(latest.id);
    });

    it('findByUser returns all of the user’s rows, inactive ones included, and no one else’s', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createRetrievalRepo(db);
        const stranger = await createUser();
        const [file, strangerFile] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: stranger.id }),
        ]);
        const expired = await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'expired',
        });
        const pending = await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'pending',
        });
        await insertRetrieval(db, {
            userId: stranger.id,
            fileId: strangerFile.id,
            status: 'pending',
        });

        const rows = await repo.findByUser(user.id);

        expect(new Set(rows.map((r) => r.id))).toEqual(
            new Set([expired.id, pending.id])
        );
    });

    // Leaving a downloadable row alone matters as much as flipping the lapsed
    // one: an `expired` row can't be downloaded, so over-expiring would cut a
    // user off from a restore they paid for.
    it('expireLapsedByFileIds flips only lapsed ready rows of the given files', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRepo(db);
        const files = await Promise.all(
            Array.from({ length: 5 }, () => insertFile(db, { userId: user.id }))
        );
        const [
            lapsedFile,
            unexpiredFile,
            noExpiryFile,
            pendingFile,
            otherFile,
        ] = files;

        const lapsed = await insertRetrieval(db, {
            userId: user.id,
            fileId: lapsedFile.id,
            status: 'ready',
            expiresAt: past(),
        });
        const unexpired = await insertRetrieval(db, {
            userId: user.id,
            fileId: unexpiredFile.id,
            status: 'ready',
            expiresAt: future(),
        });
        const noExpiry = await insertRetrieval(db, {
            userId: user.id,
            fileId: noExpiryFile.id,
            status: 'ready',
            expiresAt: null,
        });
        // A past `expiresAt` on a non-ready row: only the status gate keeps
        // this one out.
        const pending = await insertRetrieval(db, {
            userId: user.id,
            fileId: pendingFile.id,
            status: 'pending',
            expiresAt: past(),
        });
        // Lapsed, but its file isn't in the call.
        const otherLapsed = await insertRetrieval(db, {
            userId: user.id,
            fileId: otherFile.id,
            status: 'ready',
            expiresAt: past(),
        });

        await repo.expireLapsedByFileIds([
            lapsedFile.id,
            unexpiredFile.id,
            noExpiryFile.id,
            pendingFile.id,
        ]);

        const statuses = new Map(
            (await repo.findByUser(user.id)).map((r) => [r.id, r.status])
        );
        expect(Object.fromEntries(statuses)).toEqual({
            [lapsed.id]: 'expired',
            [unexpired.id]: 'ready',
            [noExpiry.id]: 'ready',
            [pending.id]: 'pending',
            [otherLapsed.id]: 'ready',
        });
    });

    // ON CONFLICT DO NOTHING against the partial unique index on active
    // retrievals (#266): the duplicate is dropped from the result, the rest of
    // the batch still goes in.
    it('insertMany skips a file that already has an active row and inserts the rest', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRepo(db);
        const [takenFile, freeFile] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);
        const winner = await insertRetrieval(db, {
            userId: user.id,
            fileId: takenFile.id,
            status: 'pending',
        });

        const inserted = await repo.insertMany(
            [takenFile, freeFile].map((file) => ({
                id: crypto.randomUUID(),
                fileId: file.id,
                userId: user.id,
                tier: 'standard' as const,
                status: 'pending' as const,
            }))
        );

        expect(inserted.map((r) => r.fileId)).toEqual([freeFile.id]);
        const active = await repo.findByFileIds([takenFile.id]);
        expect(active.map((r) => r.id)).toEqual([winner.id]);
    });

    it('updateStatus writes the status and metadata to that row only', async ({
        db,
        user,
    }) => {
        const repo = createRetrievalRepo(db);
        const [file, otherFile] = await Promise.all([
            insertFile(db, { userId: user.id }),
            insertFile(db, { userId: user.id }),
        ]);
        const target = await insertRetrieval(db, {
            userId: user.id,
            fileId: file.id,
            status: 'pending',
        });
        const bystander = await insertRetrieval(db, {
            userId: user.id,
            fileId: otherFile.id,
            status: 'pending',
        });
        const failedAt = new Date('2026-01-02T03:04:05Z');

        const updated = await repo.updateStatus(target.id, 'failed', {
            failedAt,
            errorMessage: 'AWS error',
        });

        expect(updated).toMatchObject({
            id: target.id,
            status: 'failed',
            failedAt,
            errorMessage: 'AWS error',
        });
        const rows = await repo.findByUser(user.id);
        expect(rows.find((r) => r.id === bystander.id)?.status).toBe('pending');
        expect(
            await repo.updateStatus(crypto.randomUUID(), 'failed')
        ).toBeUndefined();
    });
});
