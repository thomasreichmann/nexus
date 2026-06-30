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

        // Seed a half-finished multipart upload directly into IndexedDB, as if a
        // prior session had been interrupted (5 of 10 parts done).
        await page.evaluate(async () => {
            const open = indexedDB.open('nexus-uploads', 1);
            const db: IDBDatabase = await new Promise((res, rej) => {
                open.onupgradeneeded = () =>
                    open.result.createObjectStore('uploads', {
                        keyPath: 'fileId',
                    });
                open.onsuccess = () => res(open.result);
                open.onerror = () => rej(open.error);
            });
            await new Promise<void>((res, rej) => {
                const tx = db.transaction('uploads', 'readwrite');
                tx.objectStore('uploads').put({
                    fileId: '11111111-1111-1111-1111-111111111111',
                    uploadId: 'seeded-upload-id',
                    name: 'big-shoot.zip',
                    size: 1_048_576_000,
                    lastModified: 1700000000000,
                    mimeType: 'application/zip',
                    chunkSize: 104_857_600,
                    totalParts: 10,
                    completedParts: Array.from({ length: 5 }, (_, i) => ({
                        partNumber: i + 1,
                        etag: `"part-${i + 1}"`,
                    })),
                    createdAt: 1700000000000,
                    updatedAt: 1700000000000,
                });
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
            db.close();
        });

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
