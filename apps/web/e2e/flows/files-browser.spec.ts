/**
 * File browser interactions, run as a dedicated user (via the
 * `dedicatedUserConfig` fixture) so empty-state and exact-count assertions
 * can't race specs that share the regular/admin users.
 *
 * The seeded library is a worker-scoped fixture (`seededLibrary`): it seeds the
 * batch + files + ready retrieval once and the serial tests share it. The
 * empty-vault test doesn't request it, so under serial mode it runs first
 * against the freshly-provisioned (empty) user; the bulk-delete test runs last
 * and tears the library down.
 *
 * Server mutations that hit S3 Glacier (`restore`) are intercepted and observed
 * rather than executed — seeded s3 keys have no real objects, and a real
 * Glacier restore takes hours. Those interceptions still verify the complete UI
 * wiring: menu/button → correct tRPC mutation + payload. Deletion runs for real
 * (S3 DeleteObjects is a no-op for missing keys).
 */
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import {
    type UploadBatch,
    type File,
    insertUploadBatch,
    insertFile,
    insertRetrieval,
    deleteUserData,
} from '@nexus/db/test-db';
import { interceptTrpcCalls } from '../helpers/trpc';

const FILES_USER: TestUser = {
    email: 'files-browser-e2e@test.local',
    password: 'files-browser-e2e-password-123',
    name: 'Files Browser E2E',
};
const STATE_PATH = 'e2e/.auth/files-browser.json';
const PAGE_URL = '/dashboard/files';

interface SeededLibrary {
    batch: UploadBatch;
    archivedA: File;
    archivedB: File;
    readyDoc: File;
    standardDoc: File;
}

const test = base.extend<
    NonNullable<unknown>,
    { seededLibrary: SeededLibrary }
>({
    seededLibrary: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const batch = await insertUploadBatch(db, {
                userId,
                name: `Browser Batch ${Date.now()}`,
            });
            // Two archived files in the batch. B seeded first with an earlier
            // createdAt: the list sorts uploadedAt DESC, so A renders as the
            // batch's first row — the shift-click range test anchors on it.
            const now = Date.now();
            const archivedB = await insertFile(db, {
                userId,
                batchId: batch.id,
                name: 'arch-video-bbb.mp4',
                size: 2000,
                storageTier: 'deep_archive',
                status: 'available',
                createdAt: new Date(now - 2000),
                updatedAt: new Date(now - 2000),
            });
            const archivedA = await insertFile(db, {
                userId,
                batchId: batch.id,
                name: 'arch-photo-aaa.jpg',
                size: 1000,
                storageTier: 'glacier',
                status: 'available',
                createdAt: new Date(now - 1000),
                updatedAt: new Date(now - 1000),
            });
            // One ungrouped standard-tier file with a ready retrieval (#257
            // fast path): renders "available" with a download window, exactly
            // like a restored deep_archive copy would (#259).
            const readyDoc = await insertFile(db, {
                userId,
                name: 'ready-doc-ccc.pdf',
                size: 3000,
                storageTier: 'standard',
                status: 'available',
                createdAt: new Date(now - 100),
                updatedAt: new Date(now - 100),
            });
            await insertRetrieval(db, {
                userId,
                fileId: readyDoc.id,
                status: 'ready',
            });
            // One ungrouped standard-tier file with no retrieval: archived
            // with Retrieve only (#256), and the all-standard estimate case.
            // Seeded older than readyDoc so it sorts last — the shift-click
            // range test anchors on flat row order.
            const standardDoc = await insertFile(db, {
                userId,
                name: 'plain-doc-ddd.txt',
                size: 500,
                storageTier: 'standard',
                status: 'available',
                createdAt: new Date(now - 3000),
                updatedAt: new Date(now - 3000),
            });

            await use({ batch, archivedA, archivedB, readyDoc, standardDoc });

            // Tear the library down before the dedicated user is deleted.
            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'serial' });
test.use({ dedicatedUserConfig: { user: FILES_USER, statePath: STATE_PATH } });

test(
    'empty vault shows the empty state with an upload CTA',
    { tag: ['@page:/dashboard/files', '@uc:files-empty-state'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);

        await expect(page.getByText('Your vault is empty')).toBeVisible();
        // Base UI's non-native Button renders the CTA anchor with
        // role="button".
        await expect(
            page.getByRole('button', { name: 'Upload files' })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

test.describe('with a seeded library', () => {
    test(
        'stats bar shows library-wide status counts',
        { tag: ['@uc:files-stats-bar'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            await expect(page.getByText('4 files')).toBeVisible();
            // The ready-retrieval file counts as available (#259); files
            // without one count as archived regardless of tier (#256).
            await expect(page.getByText('3 archived')).toBeVisible();
            await expect(page.getByText('1 available')).toBeVisible();
        }
    );

    test(
        'deep-link ?file={id} highlights the target file',
        { tag: ['@uc:files-deep-link-focus'] },
        async ({ page, seededLibrary }) => {
            // The retrieval-ready email lands here; the target row should be
            // in view and visibly highlighted.
            await page.goto(`${PAGE_URL}?file=${seededLibrary.archivedB.id}`);

            const row = page.getByRole('row', {
                name: seededLibrary.archivedB.name,
            });
            await expect(row).toBeInViewport();
            // The highlight tint is seeded from the query param at first paint
            // and clears on a timer, so assert it before it fades.
            await expect(row).toHaveClass(/bg-primary\/10/);
        }
    );

    test(
        'search filters files and shows the no-match state',
        { tag: ['@uc:files-search'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            const search = page.getByPlaceholder('Search files...');
            await search.fill('aaa');

            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();
            await expect(
                page.getByText(seededLibrary.archivedB.name).first()
            ).toBeHidden();
            await expect(
                page.getByText(seededLibrary.readyDoc.name).first()
            ).toBeHidden();

            await search.fill('zzz-no-such-file');
            await expect(page.getByText(/No files match/)).toBeVisible();

            await search.clear();
            await expect(
                page.getByText(seededLibrary.archivedB.name).first()
            ).toBeVisible();
        }
    );

    test(
        'view toggles between list and grid',
        { tag: ['@uc:files-view-toggle'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(page.locator('table')).toBeVisible();

            await page.getByRole('button', { name: 'Grid view' }).click();
            await expect(page.locator('table')).toHaveCount(0);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            await page.getByRole('button', { name: 'List view' }).click();
            await expect(page.locator('table')).toBeVisible();
        }
    );

    test(
        'batch group collapses and re-expands',
        { tag: ['@uc:files-batch-expand-collapse'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            const batchToggle = page.getByRole('button', {
                name: new RegExp(seededLibrary.batch.name),
            });
            await expect(batchToggle).toHaveAttribute('aria-expanded', 'true');

            await batchToggle.click();
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeHidden();
            await expect(
                page.getByText(seededLibrary.readyDoc.name).first()
            ).toBeVisible(); // other group untouched

            await batchToggle.click();
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();
        }
    );

    test(
        'select-all selects every visible file',
        { tag: ['@uc:files-select-all'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            await page.getByRole('checkbox', { name: 'Select all' }).click();
            await expect(page.getByText('4 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Clear selection' }).click();
            await expect(page.getByText('4 selected')).toBeHidden();
        }
    );

    test(
        'multi-select via icon checkboxes and shift-click range',
        { tag: ['@uc:files-multi-select'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            // Click the first file's icon-checkbox, then shift-click the last
            // row → range selection covers all three.
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.archivedA.name}`,
                })
                .click();
            await expect(page.getByText('1 selected')).toBeVisible();

            await page
                .locator('tr', { hasText: seededLibrary.readyDoc.name })
                .click({ modifiers: ['Shift'] });
            await expect(page.getByText('3 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Clear selection' }).click();
        }
    );

    test(
        'bulk retrieve confirms through the estimate dialog',
        {
            tag: [
                '@uc:files-bulk-retrieve',
                '@uc:files-retrieve-dialog-estimate',
            ],
        },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBulkRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            // Archived files selected → Retrieve opens the estimate dialog.
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.archivedA.name}`,
                })
                .click();
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.archivedB.name}`,
                })
                .click();
            await page.getByRole('button', { name: 'Retrieve' }).click();

            // glacier + deep_archive selection → slow estimate.
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 2 files?')).toBeVisible();
            await expect(
                dialog.getByText('Ready in up to 12 hours')
            ).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('fileIds');
        }
    );

    test(
        'single file retrieval confirms through the estimate dialog',
        { tag: ['@uc:files-request-retrieval-single'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedB.name).first()
            ).toBeVisible();

            await page
                .locator('tr', { hasText: seededLibrary.archivedB.name })
                .getByRole('button', { name: 'Actions' })
                .click();
            await page
                .getByRole('menuitem', { name: 'Request retrieval' })
                .click();

            // Single deep_archive file → slow estimate.
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 1 file?')).toBeVisible();
            await expect(
                dialog.getByText('Ready in up to 12 hours')
            ).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('fileId');
        }
    );

    test(
        'batch restore confirms through the estimate dialog',
        { tag: ['@uc:files-batch-restore'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBatchRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: /Restore batch/i })
            ).toBeVisible();

            await page.getByRole('button', { name: /Restore batch/i }).click();

            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 2 files?')).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('batchId');
        }
    );

    test(
        'ready standard-tier file renders available with a download window',
        { tag: ['@uc:files-ready-download-window'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.readyDoc.name).first()
            ).toBeVisible();

            // The synthetic 7-day window (#257) renders exactly like a real
            // restore's: status "available" plus the expiry date.
            const row = page.locator('tr', {
                hasText: seededLibrary.readyDoc.name,
            });
            await expect(row.getByText('available')).toBeVisible();
            await expect(row.getByText(/until /)).toBeVisible();

            // Already downloadable → doesn't count toward bulk Retrieve.
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.readyDoc.name}`,
                })
                .click();
            await expect(
                page.getByRole('button', { name: 'Retrieve' })
            ).toBeDisabled();
            await page.getByRole('button', { name: 'Clear selection' }).click();

            // Actions menu offers Download, not Request retrieval.
            await row.getByRole('button', { name: 'Actions' }).click();
            await expect(
                page.getByRole('menuitem', { name: 'Download' })
            ).toBeVisible();
            await expect(
                page.getByRole('menuitem', { name: 'Request retrieval' })
            ).toHaveCount(0);
            await page.keyboard.press('Escape');
        }
    );

    test(
        'standard-tier file without a retrieval renders archived and estimates ~minutes',
        {
            tag: [
                '@uc:files-standard-tier-archived',
                '@uc:files-retrieve-dialog-estimate',
            ],
        },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.standardDoc.name).first()
            ).toBeVisible();

            // No retrieval yet → archived with Retrieve only, no Download,
            // same as the colder tiers (#256).
            const row = page.locator('tr', {
                hasText: seededLibrary.standardDoc.name,
            });
            await expect(row.getByText('archived')).toBeVisible();
            await row.getByRole('button', { name: 'Actions' }).click();
            await expect(
                page.getByRole('menuitem', { name: 'Request retrieval' })
            ).toBeVisible();
            await expect(
                page.getByRole('menuitem', { name: 'Download' })
            ).toHaveCount(0);
            await page.keyboard.press('Escape');

            // All-standard selection → fast estimate.
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.standardDoc.name}`,
                })
                .click();
            await page.getByRole('button', { name: 'Retrieve' }).click();
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Ready in ~minutes')).toBeVisible();
            await dialog.getByRole('button', { name: 'Cancel' }).click();
        }
    );

    test(
        'bulk delete removes the selected files after confirmation',
        { tag: ['@uc:files-bulk-delete'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeVisible();

            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.archivedA.name}`,
                })
                .click();
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.archivedB.name}`,
                })
                .click();
            await page.getByRole('button', { name: 'Delete' }).click();

            await expect(page.getByText('Delete 2 files?')).toBeVisible();
            await page
                .getByRole('button', { name: 'Delete', exact: true })
                .last()
                .click();

            await expect(
                page.getByText(seededLibrary.archivedA.name).first()
            ).toBeHidden({
                timeout: 10_000,
            });
            await expect(
                page.getByText(seededLibrary.archivedB.name).first()
            ).toBeHidden();
            await expect(
                page.getByText(seededLibrary.readyDoc.name).first()
            ).toBeVisible();
            await expect(
                page.getByText(seededLibrary.standardDoc.name).first()
            ).toBeVisible();
        }
    );
});
