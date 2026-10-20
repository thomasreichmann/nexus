/**
 * The admin list of partial batches (#550): every user's batches whose Upload
 * click sent more files than ever landed, once they've gone quiet. Seeded
 * through a user of its own, deleted with everything it owns afterwards.
 */
import {
    deleteUsers,
    insertFile,
    insertUploadBatch,
    insertUser,
} from '@nexus/db/test-db';
import { test, expect } from '../fixtures';

test.use({ userRole: 'admin' });

const PAGE_URL = '/dashboard/admin/batches';
// Just past the hour a batch has to be quiet before it's judged: the newest a
// partial batch can be, so it heads the newest-first list on a shared DB.
const justPastQuiet = () => new Date(Date.now() - 65 * 60_000);

test(
    'lists a batch that came up short with its owner and what’s missing, and not a whole one',
    { tag: ['@page:/dashboard/admin/batches', '@uc:admin-partial-batches'] },
    async ({ page, db }) => {
        const owner = await insertUser(db);
        const run = crypto.randomUUID().slice(0, 8);
        const at = justPastQuiet();
        try {
            const [short, whole] = await Promise.all([
                insertUploadBatch(db, {
                    userId: owner.id,
                    name: `Short wave ${run}`,
                    expectedFileCount: 3,
                    createdAt: at,
                }),
                insertUploadBatch(db, {
                    userId: owner.id,
                    name: `Whole wave ${run}`,
                    expectedFileCount: 1,
                    createdAt: at,
                }),
            ]);
            // One file landed in each.
            await Promise.all(
                [short, whole].map((batch) =>
                    insertFile(db, {
                        userId: owner.id,
                        batchId: batch.id,
                        createdAt: at,
                        confirmedAt: at,
                    })
                )
            );

            await page.goto(PAGE_URL);

            const row = page.getByRole('row', { name: new RegExp(short.name) });
            await expect(row).toBeVisible();
            await expect(row).toContainText(owner.email);
            await expect(row.getByRole('cell')).toContainText([
                short.name,
                owner.email,
                /ago/,
                '3',
                '1',
                '2 missing',
            ]);
            await expect(
                page.getByRole('row', { name: new RegExp(whole.name) })
            ).toHaveCount(0);
        } finally {
            await deleteUsers(db, [owner.id]);
        }
    }
);
