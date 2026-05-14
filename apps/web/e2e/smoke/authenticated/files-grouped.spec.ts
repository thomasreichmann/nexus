/**
 * Grouped files page (issue #217 PR 2). Seeds one batch + one ungrouped file
 * for the regular user so we can assert the batch header, the synthetic
 * "Ungrouped" section, and the "Restore batch" button all render — instead of
 * a smoke-test that only checks the page heading.
 */
import { test, expect } from '../../fixtures/authenticated';
import { findUserByEmail, getDb } from '../../helpers/db';
import { REGULAR_USER } from '../../helpers/auth';

test.use({ userRole: 'user' });

const TEST_BATCH_NAME = `E2E Test Batch ${Date.now()}`;

async function seedBatchAndFiles(userId: string) {
    const sql = getDb();
    const batchId = crypto.randomUUID();
    await sql`
        INSERT INTO upload_batches (id, user_id, name)
        VALUES (${batchId}, ${userId}, ${TEST_BATCH_NAME})
    `;
    // Two files in the batch, one archived (so Restore batch button shows).
    await sql`
        INSERT INTO files (id, user_id, batch_id, name, size, s3_key, storage_tier, status)
        VALUES
            (gen_random_uuid()::text, ${userId}, ${batchId}, 'batched-a.txt', 100, ${`${userId}/${batchId}/a/batched-a.txt`}, 'glacier', 'available'),
            (gen_random_uuid()::text, ${userId}, ${batchId}, 'batched-b.txt', 200, ${`${userId}/${batchId}/b/batched-b.txt`}, 'glacier', 'available')
    `;
    // One legacy file with no batch_id → renders under "Ungrouped".
    await sql`
        INSERT INTO files (id, user_id, batch_id, name, size, s3_key, storage_tier, status)
        VALUES (gen_random_uuid()::text, ${userId}, NULL, 'legacy-orphan.txt', 50, ${`${userId}/legacy/legacy-orphan.txt`}, 'standard', 'available')
    `;
    return { batchId };
}

async function cleanup(userId: string) {
    const sql = getDb();
    await sql`DELETE FROM files WHERE user_id = ${userId}`;
    await sql`DELETE FROM upload_batches WHERE user_id = ${userId}`;
}

test.describe('grouped files page', () => {
    test('renders batch header + Ungrouped + restore button', async ({
        page,
        consoleErrors,
    }) => {
        const user = await findUserByEmail(REGULAR_USER.email);
        if (!user) throw new Error('regular user missing');

        await cleanup(user.id);
        await seedBatchAndFiles(user.id);

        try {
            await page.goto('/dashboard/files');

            // Page heading still renders.
            await expect(
                page.getByRole('heading', { name: /files/i })
            ).toBeVisible();

            // Batch header renders with the seeded batch name.
            await expect(
                page.getByRole('heading', { name: TEST_BATCH_NAME })
            ).toBeVisible();

            // Metadata line shows "2 files · 300 Bytes · ..."
            await expect(page.getByText(/2 files · 300 Bytes/)).toBeVisible();

            // Restore batch button is visible (both files are glacier+available).
            await expect(
                page.getByRole('button', { name: /Restore batch/i })
            ).toBeVisible();

            // Files inside the batch are visible by default (expanded).
            await expect(page.getByText('batched-a.txt')).toBeVisible();
            await expect(page.getByText('batched-b.txt')).toBeVisible();

            // Ungrouped section renders for the legacy file.
            await expect(
                page.getByRole('heading', { name: 'Ungrouped' })
            ).toBeVisible();
            await expect(page.getByText('legacy-orphan.txt')).toBeVisible();

            expect(consoleErrors).toEqual([]);
        } finally {
            await cleanup(user.id);
        }
    });
});
