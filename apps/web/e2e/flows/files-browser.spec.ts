/**
 * File browser interactions, run as a dedicated user (created below) so
 * empty-state and exact-count assertions can't race specs that share the
 * regular/admin users.
 *
 * Server mutations that hit S3 Glacier (`restore`) are intercepted and
 * observed rather than executed — seeded s3 keys have no real objects, and a
 * real Glacier restore takes hours. Those interceptions still verify the
 * complete UI wiring: menu/button → correct tRPC mutation + payload.
 * Deletion runs for real (S3 DeleteObjects is a no-op for missing keys).
 */
import { test, expect } from '../fixtures/console';
import { provisionDedicatedUser, type TestUser } from '../helpers/auth';
import {
    deleteUserData,
    insertBatch,
    insertFile,
    insertRetrieval,
} from '../helpers/db';
import { interceptTrpcCalls } from '../helpers/trpc';

const FILES_USER: TestUser = {
    email: 'files-browser-e2e@test.local',
    password: 'files-browser-e2e-password-123',
    name: 'Files Browser E2E',
};
const STATE_PATH = 'e2e/.auth/files-browser.json';
const PAGE_URL = '/dashboard/files';

const BATCH_NAME = `Browser Batch ${Date.now()}`;
const ARCHIVED_A = 'arch-photo-aaa.jpg';
const ARCHIVED_B = 'arch-video-bbb.mp4';
const READY_DOC = 'ready-doc-ccc.pdf';

let userId: string;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: STATE_PATH });

test.beforeAll(async () => {
    ({ userId } = await provisionDedicatedUser(FILES_USER, STATE_PATH));
    await deleteUserData(userId);
});

test.afterAll(async () => {
    await deleteUserData(userId);
});

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
    test.beforeAll(async () => {
        const { id: batchId } = await insertBatch({
            userId,
            name: BATCH_NAME,
        });
        // Two archived files in the batch (glacier/deep_archive + available).
        // B inserted first: the list sorts uploadedAt DESC, so A renders as
        // the batch's first row — the shift-click range test anchors on it.
        await insertFile({
            userId,
            batchId,
            name: ARCHIVED_B,
            size: 2000,
            s3Key: `${userId}/${batchId}/b/${ARCHIVED_B}`,
            storageTier: 'deep_archive',
            status: 'available',
        });
        await insertFile({
            userId,
            batchId,
            name: ARCHIVED_A,
            size: 1000,
            s3Key: `${userId}/${batchId}/a/${ARCHIVED_A}`,
            storageTier: 'glacier',
            status: 'available',
        });
        // One ungrouped standard file with a ready retrieval → derived status
        // "available", Download action enabled.
        const readyFile = await insertFile({
            userId,
            name: READY_DOC,
            size: 3000,
            s3Key: `${userId}/legacy/${READY_DOC}`,
            storageTier: 'standard',
            status: 'available',
        });
        await insertRetrieval({
            fileId: readyFile.id,
            userId,
            status: 'ready',
        });
    });

    test(
        'stats bar shows library-wide status counts',
        { tag: ['@uc:files-stats-bar'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);

            await expect(page.getByText('3 files')).toBeVisible();
            await expect(page.getByText('2 archived')).toBeVisible();
            await expect(page.getByText('1 available')).toBeVisible();
        }
    );

    test(
        'search filters files and shows the no-match state',
        { tag: ['@uc:files-search'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            const search = page.getByPlaceholder('Search files...');
            await search.fill('aaa');

            await expect(page.getByText(ARCHIVED_A)).toBeVisible();
            await expect(page.getByText(ARCHIVED_B)).toBeHidden();
            await expect(page.getByText(READY_DOC)).toBeHidden();

            await search.fill('zzz-no-such-file');
            await expect(page.getByText(/No files match/)).toBeVisible();

            await search.clear();
            await expect(page.getByText(ARCHIVED_B)).toBeVisible();
        }
    );

    test(
        'view toggles between list and grid',
        { tag: ['@uc:files-view-toggle'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.locator('table')).toBeVisible();

            await page.getByRole('button', { name: 'Grid view' }).click();
            await expect(page.locator('table')).toHaveCount(0);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            await page.getByRole('button', { name: 'List view' }).click();
            await expect(page.locator('table')).toBeVisible();
        }
    );

    test(
        'batch group collapses and re-expands',
        { tag: ['@uc:files-batch-expand-collapse'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            const batchToggle = page.getByRole('button', {
                name: new RegExp(BATCH_NAME),
            });
            await expect(batchToggle).toHaveAttribute('aria-expanded', 'true');

            await batchToggle.click();
            await expect(page.getByText(ARCHIVED_A)).toBeHidden();
            await expect(page.getByText(READY_DOC)).toBeVisible(); // other group untouched

            await batchToggle.click();
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();
        }
    );

    test(
        'select-all selects every visible file',
        { tag: ['@uc:files-select-all'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            await page.getByRole('checkbox', { name: 'Select all' }).click();
            await expect(page.getByText('3 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Clear selection' }).click();
            await expect(page.getByText('3 selected')).toBeHidden();
        }
    );

    test(
        'multi-select via icon checkboxes and shift-click range',
        { tag: ['@uc:files-multi-select'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            // Click the first file's icon-checkbox, then shift-click the last
            // row → range selection covers all three.
            await page
                .getByRole('button', { name: `Select ${ARCHIVED_A}` })
                .click();
            await expect(page.getByText('1 selected')).toBeVisible();

            await page
                .locator('tr', { hasText: READY_DOC })
                .click({ modifiers: ['Shift'] });
            await expect(page.getByText('3 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Clear selection' }).click();
        }
    );

    test(
        'bulk retrieve submits the archived selection',
        { tag: ['@uc:files-bulk-retrieve'] },
        async ({ page }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBulkRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            // Only the non-archived file selected → Retrieve disabled.
            await page
                .getByRole('button', { name: `Select ${READY_DOC}` })
                .click();
            await expect(
                page.getByRole('button', { name: 'Retrieve' })
            ).toBeDisabled();
            await page.getByRole('button', { name: 'Clear selection' }).click();

            // Archived files selected → Retrieve fires the bulk mutation.
            await page
                .getByRole('button', { name: `Select ${ARCHIVED_A}` })
                .click();
            await page
                .getByRole('button', { name: `Select ${ARCHIVED_B}` })
                .click();
            await page.getByRole('button', { name: 'Retrieve' }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('fileIds');
        }
    );

    test(
        'single file retrieval fires from the actions menu',
        { tag: ['@uc:files-request-retrieval-single'] },
        async ({ page }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_B)).toBeVisible();

            await page
                .locator('tr', { hasText: ARCHIVED_B })
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
        async ({ page }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBatchRetrieval'
            );

            await page.goto(PAGE_URL);
            await expect(
                page.getByRole('button', { name: /Restore batch/i })
            ).toBeVisible();

            await page.getByRole('button', { name: /Restore batch/i }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('batchId');
        }
    );

    test(
        'download opens a presigned URL for an available file',
        { tag: ['@uc:files-download-available'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.getByText(READY_DOC)).toBeVisible();

            await page
                .locator('tr', { hasText: READY_DOC })
                .getByRole('button', { name: 'Actions' })
                .click();

            const popupPromise = page.waitForEvent('popup');
            await page.getByRole('menuitem', { name: 'Download' }).click();
            const popup = await popupPromise;

            // Presigned S3 GET — signature params prove it went through the
            // presigner rather than a bare bucket URL.
            expect(popup.url()).toContain('X-Amz-');
            await popup.close();
        }
    );

    test(
        'bulk delete removes the selected files after confirmation',
        { tag: ['@uc:files-bulk-delete'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await expect(page.getByText(ARCHIVED_A)).toBeVisible();

            await page
                .getByRole('button', { name: `Select ${ARCHIVED_A}` })
                .click();
            await page
                .getByRole('button', { name: `Select ${ARCHIVED_B}` })
                .click();
            await page.getByRole('button', { name: 'Delete' }).click();

            await expect(page.getByText('Delete 2 files?')).toBeVisible();
            await page
                .getByRole('button', { name: 'Delete', exact: true })
                .last()
                .click();

            await expect(page.getByText(ARCHIVED_A)).toBeHidden({
                timeout: 10_000,
            });
            await expect(page.getByText(ARCHIVED_B)).toBeHidden();
            await expect(page.getByText(READY_DOC)).toBeVisible();
        }
    );
});
