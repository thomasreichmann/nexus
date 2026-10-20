import { it, expect, describe } from '../test-db/integration';
import { insertFile, insertUploadBatch, type DB, type File } from '../test-db';
import { STALE_UPLOAD_HOURS } from './files';
import { createLibraryRepo } from './library';
import { createUploadBatchRepo } from './uploadBatches';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

/** What became of one file a batch's Upload click sent. */
const CONFIRMED: Partial<File> = { status: 'available' };
const DELETED_LATER: Partial<File> = {
    status: 'deleted',
    deletedAt: hoursAgo(1.5),
};
const ABANDONED: Partial<File> = { status: 'deleted', confirmedAt: null };
const UPLOADING: Partial<File> = { status: 'uploading', confirmedAt: null };

/**
 * A batch whose Upload click sent `expected` files, with a row for each of
 * `files`: everything stamped `at`, two hours ago unless said otherwise.
 */
async function seedBatch(
    db: DB,
    userId: string,
    expected: number | null,
    files: Partial<File>[],
    at = hoursAgo(2)
) {
    const batch = await insertUploadBatch(db, {
        userId,
        expectedFileCount: expected,
        createdAt: at,
    });
    await Promise.all(
        files.map((file) =>
            insertFile(db, {
                userId,
                batchId: batch.id,
                createdAt: at,
                confirmedAt: at,
                ...file,
            })
        )
    );
    return batch;
}

// #550: a batch that came up short, told apart from one the user pruned, one
// still on its way, and one from before expectations were recorded.
describe('partial batches', () => {
    it('lists every user’s batches that came up short, by how many', async ({
        db,
        user,
        createUser,
    }) => {
        const other = await createUser();
        const [died, nothingLanded, tabClosed, othersDied] = await Promise.all([
            seedBatch(db, user.id, 3, [CONFIRMED, ABANDONED]),
            seedBatch(db, user.id, 2, []),
            // Its in-flight row stayed `uploading` past the stale mark.
            seedBatch(db, user.id, 3, [
                CONFIRMED,
                { ...UPLOADING, createdAt: hoursAgo(STALE_UPLOAD_HOURS + 1) },
            ]),
            seedBatch(db, other.id, 2, [CONFIRMED]),
        ]);
        const recently = hoursAgo(0.15);
        const notPartial = await Promise.all([
            // The user deleted a file they'd uploaded: not missing.
            seedBatch(db, user.id, 2, [CONFIRMED, DELETED_LATER]),
            seedBatch(db, user.id, 2, [CONFIRMED, CONFIRMED]),
            // A large file still uploading hours in, with the rest of the
            // wave queued behind it and no rows of their own yet.
            seedBatch(db, user.id, 5, [CONFIRMED, UPLOADING]),
            // Not quiet yet: the wave may be between files.
            seedBatch(db, user.id, 3, [CONFIRMED], hoursAgo(0.25)),
            // An old batch whose wave confirmed a file minutes ago.
            seedBatch(db, user.id, 3, [
                { ...CONFIRMED, createdAt: recently, confirmedAt: recently },
            ]),
            // Confirmed by code that didn't stamp it yet (the deploy window).
            seedBatch(db, user.id, 1, [{ ...CONFIRMED, confirmedAt: null }]),
            // More received than expected: never a negative count.
            seedBatch(db, user.id, 1, [CONFIRMED, CONFIRMED]),
            // From before expectations were recorded.
            seedBatch(db, user.id, null, [CONFIRMED]),
        ]);
        const seeded = new Set(
            [died, nothingLanded, tabClosed, othersDied, ...notPartial].map(
                (batch) => batch.id
            )
        );

        // A page big enough for every partial batch a shared database holds.
        const { batches, total } = await createUploadBatchRepo(db).listPartial({
            limit: 10_000,
            offset: 0,
        });

        expect(
            Object.fromEntries(
                batches
                    .filter((batch) => seeded.has(batch.batchId))
                    .map((batch) => [batch.batchId, batch.missingFileCount])
            )
        ).toEqual({
            [died.id]: 2,
            [nothingLanded.id]: 2,
            [tabClosed.id]: 2,
            [othersDied.id]: 1,
        });
        expect(batches.find((batch) => batch.batchId === died.id)).toEqual({
            batchId: died.id,
            name: died.name,
            createdAt: died.createdAt,
            userId: user.id,
            userEmail: user.email,
            expectedFileCount: 3,
            receivedFileCount: 1,
            missingFileCount: 2,
        });
        expect(total).toBe(batches.length);
    });

    it('pages newest first', async ({ db, user }) => {
        const [older, newer] = await Promise.all([
            seedBatch(db, user.id, 2, [], hoursAgo(3)),
            seedBatch(db, user.id, 2, [], hoursAgo(2)),
        ]);
        const repo = createUploadBatchRepo(db);

        const { batches } = await repo.listPartial({
            limit: 10_000,
            offset: 0,
        });
        const ours = batches
            .map((batch) => batch.batchId)
            .filter((id) => id === older.id || id === newer.id);

        expect(ours).toEqual([newer.id, older.id]);
    });

    it('shows on the library’s batch, with what it expected', async ({
        db,
        user,
    }) => {
        const [died, whole] = await Promise.all([
            seedBatch(db, user.id, 3, [CONFIRMED]),
            seedBatch(db, user.id, 1, [CONFIRMED]),
        ]);
        const library = createLibraryRepo(db);

        expect(await library.findBatch(user.id, died.id)).toMatchObject({
            expectedFileCount: 3,
            missingFileCount: 2,
        });
        expect(await library.findBatch(user.id, whole.id)).toMatchObject({
            expectedFileCount: 1,
            missingFileCount: 0,
        });
    });
});

// The reference repository test (docs/conventions/testing.md): real rows,
// including one each term of the predicate must exclude, and an assertion on
// what the query returns. A mocked `findFirst` returns whatever the test told
// it to, so it could never see either filter below go missing (#489, #524).
describe('findByUserAndId', () => {
    // Asking for each of two batches: without the id term, both lookups get
    // the same one back, whichever row Postgres finds first.
    it('returns the batch asked for, not the owner’s other one', async ({
        db,
        user,
    }) => {
        const [a, b] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const repo = createUploadBatchRepo(db);

        expect((await repo.findByUserAndId(user.id, a.id))?.id).toBe(a.id);
        expect((await repo.findByUserAndId(user.id, b.id))?.id).toBe(b.id);
    });

    it('does not return another user’s batch, even by its id', async ({
        db,
        user,
        createUser,
    }) => {
        const owner = await createUser();
        const batch = await insertUploadBatch(db, { userId: owner.id });

        const found = await createUploadBatchRepo(db).findByUserAndId(
            user.id,
            batch.id
        );

        expect(found).toBeUndefined();
    });
});
