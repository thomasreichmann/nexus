/**
 * Interrupted multipart uploads: how the queue surfaces, keeps and discards
 * them. Each test seeds the resume record straight into the page's IndexedDB
 * (`seedResumableUpload`), which lives in the test's own browser context. The
 * seeded file has no server row, so the tests write none and need no teardown.
 */
import { test, expect } from '../fixtures';
import { fileName } from '../helpers/table';
import { UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import {
    seedResumableUpload,
    readResumableUploadIds,
} from '../helpers/uploadStore';

// One worker for the file, so it signs up one user rather than one per worker
// its tests spread to. Not `serial`: no test hands state to the next.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('resume') });

test(
    'an interrupted upload is detected on load and shown as resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-resume-detect'] },
    async ({ page, consoleErrors }) => {
        await page.goto(UPLOAD_PAGE_URL);
        // Wait for the app to open the IndexedDB store before seeding it.
        await expect(
            page.getByText('Drop files or folders here to upload')
        ).toBeVisible();

        // Seed a half-finished multipart upload (5 of 10 parts) with no persisted
        // handle, as if a prior session had been interrupted before this feature.
        await seedResumableUpload(page);

        await page.reload();

        // The interrupted upload surfaces as resumable (not failed), with its
        // prior progress and a re-add prompt — no retry/error affordance.
        await expect(fileName(page, 'big-shoot.zip')).toBeVisible();
        await expect(
            page.getByText('Interrupted — re-add this file to resume')
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Cancel upload' })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Retry upload' })
        ).toBeHidden();

        expect(consoleErrors).toEqual([]);
    }
);

// Clear all used to release every row it swept, which for a multipart row
// meant aborting the S3 session and deleting its IndexedDB record — tidying
// the list silently destroyed an upload the queue was offering to resume.
test(
    'clear-all leaves an interrupted upload resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-clear-keeps-resumable'] },
    async ({ page, consoleErrors }) => {
        await page.goto(UPLOAD_PAGE_URL);
        await expect(
            page.getByText('Drop files or folders here to upload')
        ).toBeVisible();

        await seedResumableUpload(page);
        await page.reload();
        await expect(
            page.getByText('Interrupted — re-add this file to resume')
        ).toBeVisible();

        await page.getByRole('button', { name: 'Clear all' }).click();
        await expect(page.getByText(/Selected Files/)).toBeHidden();

        // The record outlives the clear: a reload rehydrates the same row.
        await page.reload();
        await expect(fileName(page, 'big-shoot.zip')).toBeVisible();
        await expect(
            page.getByText('Interrupted — re-add this file to resume')
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

// The per-row X on an in-flight or resumable row aborts the S3 session and
// deletes the resume record — visually identical to the harmless Remove on a
// pending row, so a misclick deep into a big upload used to be unrecoverable
// (#389). It now confirms first.
test(
    'cancelling a resumable upload asks for confirmation first',
    { tag: ['@page:/dashboard/upload', '@uc:upload-cancel-guard'] },
    async ({ page }) => {
        await page.goto(UPLOAD_PAGE_URL);
        await expect(
            page.getByText('Drop files or folders here to upload')
        ).toBeVisible();

        await seedResumableUpload(page);
        await page.reload();
        await expect(fileName(page, 'big-shoot.zip')).toBeVisible();

        // The X opens the guard instead of destroying the upload outright.
        await page.getByRole('button', { name: 'Cancel upload' }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog.getByText('Cancel this upload?')).toBeVisible();

        // Backing out leaves the upload untouched — still resumable after a
        // reload.
        await dialog.getByRole('button', { name: 'Keep upload' }).click();
        await expect(dialog).toBeHidden();
        await page.reload();
        await expect(fileName(page, 'big-shoot.zip')).toBeVisible();

        // Confirming destroys it for real: row gone, and the resume record
        // with it — a reload resurrects nothing.
        await page.getByRole('button', { name: 'Cancel upload' }).click();
        await dialog.getByRole('button', { name: 'Cancel upload' }).click();
        await expect(page.getByText(/Selected Files/)).toBeHidden();
        // The row leaves the list before its resume record is deleted — that
        // delete is fire-and-forget — so reloading on the empty queue alone
        // races the store and resurrects the upload under load.
        await expect.poll(() => readResumableUploadIds(page)).toEqual([]);
        await page.reload();
        await expect(
            page.getByText('Drop files or folders here to upload')
        ).toBeVisible();
        await expect(fileName(page, 'big-shoot.zip')).toBeHidden();
    }
);

test(
    'an interrupted upload with a persisted handle is shown as one-click resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-resume-one-click'] },
    async ({ page, consoleErrors }) => {
        await page.goto(UPLOAD_PAGE_URL);
        await expect(
            page.getByText('Drop files or folders here to upload')
        ).toBeVisible();

        // Seed an interrupted upload that captured a File System Access handle.
        // A plain stand-in is enough for the surfacing: the app keys the
        // one-click affordance on the handle's presence + browser support
        // (Chromium, which Playwright runs). The actual reopen/permission flow
        // can't be driven from a script, so it's covered by unit tests.
        await seedResumableUpload(page, {
            fileId: '22222222-2222-2222-2222-222222222222',
            uploadId: 'seeded-handle-upload-id',
            name: 'handle-shoot.zip',
            size: 2_097_152_000,
            totalParts: 20,
            completedCount: 7,
            fileHandle: { kind: 'file', name: 'handle-shoot.zip' },
        });

        await page.reload();

        // The row offers one-click resume (not the re-add prompt), with both a
        // per-row Resume button and a Resume-all affordance.
        await expect(fileName(page, 'handle-shoot.zip')).toBeVisible();
        await expect(
            page.getByText('Interrupted — resume in one click')
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Resume', exact: true })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Resume all' })
        ).toBeVisible();
        await expect(
            page.getByText('Interrupted — re-add this file to resume')
        ).toBeHidden();

        expect(consoleErrors).toEqual([]);
    }
);
