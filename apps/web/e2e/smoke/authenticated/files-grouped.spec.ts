/**
 * Grouped files page (issue #217 PR 2). A spec-local fixture seeds one batch +
 * one ungrouped file for the regular user (back door, with teardown) so we can
 * assert the batch card, the synthetic "Ungrouped" card, and the opened
 * batch's files and "Restore batch" button all render — instead of a
 * smoke-test that only checks the page heading.
 */
import {
    insertUploadBatch,
    insertFile,
    deleteUserData,
} from '@nexus/db/test-db';
import { test as base, expect } from '../../fixtures';

const test = base.extend<{ groupedFiles: { batchName: string } }>({
    groupedFiles: async ({ db, seedUserId }, use) => {
        await deleteUserData(db, seedUserId);
        const batch = await insertUploadBatch(db, {
            userId: seedUserId,
            name: `E2E Test Batch ${Date.now()}`,
        });
        // Two files in the batch, neither with an active retrieval — so both
        // derive as archived and the Restore batch button shows. They sum to
        // 300 bytes for the metadata-line assertion.
        await insertFile(db, {
            userId: seedUserId,
            batchId: batch.id,
            name: 'batched-a.txt',
            size: 100,
            status: 'available',
        });
        await insertFile(db, {
            userId: seedUserId,
            batchId: batch.id,
            name: 'batched-b.txt',
            size: 200,
            status: 'available',
        });
        // One legacy file with no batch_id → renders under "Ungrouped".
        await insertFile(db, {
            userId: seedUserId,
            name: 'legacy-orphan.txt',
            size: 50,
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

            // The library shows each batch as a card: the seeded batch with
            // its "2 files · 300 Bytes · ..." metadata, and a synthetic
            // Ungrouped card for the legacy file.
            const batchCard = page.getByRole('button', {
                name: `Open ${groupedFiles.batchName}`,
            });
            await expect(batchCard).toBeVisible();
            await expect(
                batchCard.getByText(/2 files · 300 Bytes/)
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Open Ungrouped' })
            ).toBeVisible();

            // Batches start closed; opening one shows its files and the
            // restore action (both files are glacier+available).
            await batchCard.click();
            await expect(
                page.getByRole('heading', { name: groupedFiles.batchName })
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: /Restore batch/i })
            ).toBeVisible();
            // first: MiddleTruncateName renders two copies (sr-only full
            // name + aria-hidden fitted).
            await expect(page.getByText('batched-a.txt').first()).toBeVisible();
            await expect(page.getByText('batched-b.txt').first()).toBeVisible();

            // The batch list switches the pane to Ungrouped's legacy file.
            await page.getByRole('button', { name: /^Ungrouped/ }).click();
            await expect(
                page.getByText('legacy-orphan.txt').first()
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );
});
