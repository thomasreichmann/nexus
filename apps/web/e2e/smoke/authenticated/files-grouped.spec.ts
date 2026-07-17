/**
 * Grouped files page (issue #217 PR 2). A spec-local fixture seeds one batch +
 * one ungrouped file for the regular user (back door, with teardown) so we can
 * assert the batch header, the synthetic "Ungrouped" section, and the "Restore
 * batch" button all render — instead of a smoke-test that only checks the page
 * heading.
 */
import { test as base, expect } from '../../fixtures';
import {
    insertUploadBatch,
    insertFile,
    deleteUserData,
} from '@nexus/db/test-db';

const test = base.extend<{ groupedFiles: { batchName: string } }>({
    groupedFiles: async ({ db, seedUserId }, use) => {
        await deleteUserData(db, seedUserId);
        const batch = await insertUploadBatch(db, {
            userId: seedUserId,
            name: `E2E Test Batch ${Date.now()}`,
        });
        // Two files in the batch, both archived (so Restore batch button shows),
        // summing to 300 bytes for the metadata-line assertion.
        await insertFile(db, {
            userId: seedUserId,
            batchId: batch.id,
            name: 'batched-a.txt',
            size: 100,
            storageTier: 'glacier',
            status: 'available',
        });
        await insertFile(db, {
            userId: seedUserId,
            batchId: batch.id,
            name: 'batched-b.txt',
            size: 200,
            storageTier: 'glacier',
            status: 'available',
        });
        // One legacy file with no batch_id → renders under "Ungrouped".
        await insertFile(db, {
            userId: seedUserId,
            name: 'legacy-orphan.txt',
            size: 50,
            storageTier: 'standard',
            status: 'available',
        });

        await use({ batchName: batch.name });

        await deleteUserData(db, seedUserId);
    },
});

test.use({ userRole: 'user' });

test.describe('grouped files page', () => {
    test(
        'renders batch header + Ungrouped + restore button',
        { tag: ['@page:/dashboard/files', '@uc:files-grouped-render'] },
        async ({ page, consoleErrors, groupedFiles }) => {
            await page.goto('/dashboard/files');

            // Page heading still renders.
            await expect(
                page.getByRole('heading', { name: /files/i })
            ).toBeVisible();

            // Batch header renders with the seeded batch name.
            await expect(
                page.getByRole('heading', { name: groupedFiles.batchName })
            ).toBeVisible();

            // Metadata line shows "2 files · 300 Bytes · ...". The list view
            // is dual markup (stacked rows below sm + table), so the batch
            // header renders twice — filter to the copy the viewport shows.
            await expect(
                page.getByText(/2 files · 300 Bytes/).filter({ visible: true })
            ).toBeVisible();

            // Restore batch button is visible (both files are glacier+available).
            await expect(
                page.getByRole('button', { name: /Restore batch/i })
            ).toBeVisible();

            // Files inside the batch are visible by default (expanded).
            // visible+first: each name renders four times — dual markup
            // (stacked rows below sm + table) × MiddleTruncateName's two
            // copies (sr-only full name + aria-hidden fitted).
            await expect(
                page
                    .getByText('batched-a.txt')
                    .filter({ visible: true })
                    .first()
            ).toBeVisible();
            await expect(
                page
                    .getByText('batched-b.txt')
                    .filter({ visible: true })
                    .first()
            ).toBeVisible();

            // Ungrouped section renders for the legacy file.
            await expect(
                page.getByRole('heading', { name: 'Ungrouped' })
            ).toBeVisible();
            await expect(
                page
                    .getByText('legacy-orphan.txt')
                    .filter({ visible: true })
                    .first()
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );
});
