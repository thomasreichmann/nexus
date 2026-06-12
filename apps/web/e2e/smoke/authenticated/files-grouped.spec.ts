/**
 * Grouped files page (issue #217 PR 2). Seeds one batch + one ungrouped file
 * for the regular user so we can assert the batch header, the synthetic
 * "Ungrouped" section, and the "Restore batch" button all render — instead of
 * a smoke-test that only checks the page heading.
 */
import { test, expect } from '../../fixtures/authenticated';
import {
    deleteUserData,
    findUserByEmail,
    insertBatch,
    insertFile,
} from '../../helpers/db';
import { REGULAR_USER } from '../../helpers/auth';

test.use({ userRole: 'user' });

const TEST_BATCH_NAME = `E2E Test Batch ${Date.now()}`;

async function seedBatchAndFiles(userId: string) {
    const { id: batchId } = await insertBatch({
        userId,
        name: TEST_BATCH_NAME,
    });
    // Two files in the batch, both archived (so Restore batch button shows).
    await insertFile({
        userId,
        batchId,
        name: 'batched-a.txt',
        size: 100,
        s3Key: `${userId}/${batchId}/a/batched-a.txt`,
        storageTier: 'glacier',
        status: 'available',
    });
    await insertFile({
        userId,
        batchId,
        name: 'batched-b.txt',
        size: 200,
        s3Key: `${userId}/${batchId}/b/batched-b.txt`,
        storageTier: 'glacier',
        status: 'available',
    });
    // One legacy file with no batch_id → renders under "Ungrouped".
    await insertFile({
        userId,
        name: 'legacy-orphan.txt',
        size: 50,
        s3Key: `${userId}/legacy/legacy-orphan.txt`,
        storageTier: 'standard',
        status: 'available',
    });
    return { batchId };
}

test.describe('grouped files page', () => {
    test(
        'renders batch header + Ungrouped + restore button',
        { tag: ['@page:/dashboard/files', '@uc:files-grouped-render'] },
        async ({ page, consoleErrors }) => {
            const user = await findUserByEmail(REGULAR_USER.email);
            if (!user) throw new Error('regular user missing');

            await deleteUserData(user.id);
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
                await expect(
                    page.getByText(/2 files · 300 Bytes/)
                ).toBeVisible();

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
                await deleteUserData(user.id);
            }
        }
    );
});
