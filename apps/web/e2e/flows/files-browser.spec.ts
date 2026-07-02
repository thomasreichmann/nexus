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
}

const test = base.extend<
    Record<string, never>,
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
            // One ungrouped standard-tier file with a ready retrieval. Every
            // tier derives status "archived" (#256), so this row must render
            // identically to the deep_archive ones: Retrieve, no Download.
            const readyDoc = await insertFile(db, {
                userId,
                name: 'ready-doc-ccc.pdf',
                size: 3000,
                storageTier: 'standard',
                status: 'available',
            });
            await insertRetrieval(db, {
                userId,
                fileId: readyDoc.id,
                status: 'ready',
            });

            await use({ batch, archivedA, archivedB, readyDoc });

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
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();

            await expect(page.getByText('3 files')).toBeVisible();
            // Standard tier counts as archived (#256); the "available" chip
            // only renders for a non-zero count, so it must be absent.
            await expect(page.getByText('3 archived')).toBeVisible();
            await expect(page.getByText(/\d+ available/)).toBeHidden();
        }
    );

    test(
        'deep-link ?file={id} highlights the target file',
        { tag: ['@uc:files-deep-link-focus'] },
        async ({ page, seededLibrary }) => {
            // The retrieval-ready email lands here; the target row should be
            // in view and visibly highlighted.
            await page.goto(`${PAGE_URL}?file=${seededLibrary.archivedB.id}`);

            const row = page.locator(
                `[data-file-id="${seededLibrary.archivedB.id}"]`
            );
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
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();

            const search = page.getByPlaceholder('Search files...');
            await search.fill('aaa');

            await expect(
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();
            await expect(
                page.getByText(seededLibrary.archivedB.name)
            ).toBeHidden();
            await expect(
                page.getByText(seededLibrary.readyDoc.name)
            ).toBeHidden();

            await search.fill('zzz-no-such-file');
            await expect(page.getByText(/No files match/)).toBeVisible();

            await search.clear();
            await expect(
                page.getByText(seededLibrary.archivedB.name)
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
                page.getByText(seededLibrary.archivedA.name)
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
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();

            const batchToggle = page.getByRole('button', {
                name: new RegExp(seededLibrary.batch.name),
            });
            await expect(batchToggle).toHaveAttribute('aria-expanded', 'true');

            await batchToggle.click();
            await expect(
                page.getByText(seededLibrary.archivedA.name)
            ).toBeHidden();
            await expect(
                page.getByText(seededLibrary.readyDoc.name)
            ).toBeVisible(); // other group untouched

            await batchToggle.click();
            await expect(
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();
        }
    );

    test(
        'select-all selects every visible file',
        { tag: ['@uc:files-select-all'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();

            await page.getByRole('checkbox', { name: 'Select all' }).click();
            await expect(page.getByText('3 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Clear selection' }).click();
            await expect(page.getByText('3 selected')).toBeHidden();
        }
    );

    test(
        'multi-select via icon checkboxes and shift-click range',
        { tag: ['@uc:files-multi-select'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name)
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
        'bulk retrieve submits the archived selection',
        { tag: ['@uc:files-bulk-retrieve'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBulkRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();

            // Archived files selected → Retrieve fires the bulk mutation.
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

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('fileIds');
        }
    );

    test(
        'single file retrieval fires from the actions menu',
        { tag: ['@uc:files-request-retrieval-single'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedB.name)
            ).toBeVisible();

            await page
                .locator('tr', { hasText: seededLibrary.archivedB.name })
                .getByRole('button', { name: 'Actions' })
                .click();
            await page
                .getByRole('menuitem', { name: 'Request retrieval' })
                .click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('fileId');
        }
    );

    test(
        'batch restore fires from the batch header',
        { tag: ['@uc:files-batch-restore'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBatchRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name)
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: /Restore batch/i })
            ).toBeVisible();

            await page.getByRole('button', { name: /Restore batch/i }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('batchId');
        }
    );

    test(
        'standard-tier file renders archived with Retrieve, no Download',
        { tag: ['@uc:files-standard-tier-archived'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.readyDoc.name)
            ).toBeVisible();

            // Row renders identically to a deep_archive row (#256).
            const row = page.locator('tr', {
                hasText: seededLibrary.readyDoc.name,
            });
            await expect(row.getByText('archived')).toBeVisible();

            // Selecting it counts toward the bulk Retrieve selection.
            await page
                .getByRole('button', {
                    name: `Select ${seededLibrary.readyDoc.name}`,
                })
                .click();
            await expect(
                page.getByRole('button', { name: 'Retrieve' })
            ).toBeEnabled();
            await page.getByRole('button', { name: 'Clear selection' }).click();

            // Actions menu offers Retrieve only — no Download for any tier.
            await row.getByRole('button', { name: 'Actions' }).click();
            await expect(
                page.getByRole('menuitem', { name: 'Request retrieval' })
            ).toBeVisible();
            await expect(
                page.getByRole('menuitem', { name: 'Download' })
            ).toHaveCount(0);
            await page.keyboard.press('Escape');
        }
    );

    test(
        'bulk delete removes the selected files after confirmation',
        { tag: ['@uc:files-bulk-delete'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                page.getByText(seededLibrary.archivedA.name)
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
                page.getByText(seededLibrary.archivedA.name)
            ).toBeHidden({
                timeout: 10_000,
            });
            await expect(
                page.getByText(seededLibrary.archivedB.name)
            ).toBeHidden();
            await expect(
                page.getByText(seededLibrary.readyDoc.name)
            ).toBeVisible();
        }
    );
});
