/**
 * Upload queue interactions, run as a dedicated user (provisioned by the
 * `dedicatedUserConfig` fixture). All client-side — the one test that reaches
 * the server (`files.upload`) intercepts and aborts the mutation, so no DB rows
 * or S3 objects are created. The real end-to-end upload lives in the validate
 * tier (upload-batches-and-quota.spec.ts).
 */
import { test, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { interceptTrpcCalls } from '../helpers/trpc';
import { seedResumableUpload } from '../helpers/uploadStore';

const UPLOAD_USER: TestUser = {
    email: 'upload-flows-e2e@test.local',
    password: 'upload-flows-e2e-password-123',
    name: 'Upload Flows E2E',
};
const STATE_PATH = 'e2e/.auth/upload-flows.json';
const PAGE_URL = '/dashboard/upload';

const FILE_A = {
    name: 'queue-a.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('queue file a\n'),
};
const FILE_B = {
    name: 'queue-b.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('queue file b — slightly longer\n'),
};

test.describe.configure({ mode: 'serial' });
test.use({ dedicatedUserConfig: { user: UPLOAD_USER, statePath: STATE_PATH } });

test(
    'adding files builds the queue with names, sizes, and a remove control',
    { tag: ['@page:/dashboard/upload', '@uc:upload-add-files-queue'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);

        await page.setInputFiles('input[type="file"]', [FILE_A, FILE_B]);

        await expect(page.getByText('Selected Files (2)')).toBeVisible();
        await expect(page.getByText(FILE_A.name)).toBeVisible();
        await expect(page.getByText(FILE_B.name)).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 2 files' })
        ).toBeVisible();

        // Remove one queued file.
        await page.getByRole('button', { name: 'Remove' }).first().click();
        await expect(page.getByText('Selected Files (1)')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 1 file' })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

test(
    'clear-all empties the pending queue',
    { tag: ['@page:/dashboard/upload', '@uc:upload-clear-queue'] },
    async ({ page }) => {
        await page.goto(PAGE_URL);

        await page.setInputFiles('input[type="file"]', [FILE_A, FILE_B]);
        await expect(page.getByText('Selected Files (2)')).toBeVisible();

        await page.getByRole('button', { name: 'Clear all' }).click();

        await expect(page.getByText(/Selected Files/)).toBeHidden();
    }
);

test(
    'an interrupted upload is detected on load and shown as resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-resume-detect'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);
        // Wait for the app to open the IndexedDB store before seeding it.
        await expect(page.getByText('Drop files here to upload')).toBeVisible();

        // Seed a half-finished multipart upload (5 of 10 parts) with no persisted
        // handle, as if a prior session had been interrupted before this feature.
        await seedResumableUpload(page);

        await page.reload();

        // The interrupted upload surfaces as resumable (not failed), with its
        // prior progress and a re-add prompt — no retry/error affordance.
        await expect(page.getByText('big-shoot.zip')).toBeVisible();
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

test(
    'an interrupted upload with a persisted handle is shown as one-click resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-resume-one-click'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);
        await expect(page.getByText('Drop files here to upload')).toBeVisible();

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
        await expect(page.getByText('handle-shoot.zip')).toBeVisible();
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

test(
    'failed upload shows the error state and retry re-attempts it',
    { tag: ['@page:/dashboard/upload', '@uc:upload-failure-retry'] },
    async ({ page }) => {
        const uploadCalls = await interceptTrpcCalls(page, 'files.upload');

        await page.goto(PAGE_URL);

        await page.setInputFiles('input[type="file"]', [FILE_A]);
        await page.getByRole('button', { name: 'Upload 1 file' }).click();

        // First attempt fails → inline error + retry affordance.
        await expect(
            page.getByRole('button', { name: 'Retry upload' })
        ).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: 'Retry upload' }).click();

        // Retry re-fires the same mutation (still intercepted → errors again).
        await expect
            .poll(() => uploadCalls.length, { timeout: 10_000 })
            .toBe(2);
        await expect(
            page.getByRole('button', { name: 'Retry upload' })
        ).toBeVisible({ timeout: 15_000 });
    }
);
