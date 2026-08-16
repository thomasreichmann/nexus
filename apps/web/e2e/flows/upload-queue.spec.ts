/**
 * Upload queue interactions, run as a dedicated user (provisioned by the
 * `dedicatedUserConfig` fixture). The retry test intercepts and aborts
 * `files.upload`, so it creates nothing.
 *
 * The rest write real rows. The cancel-cleanup test needs an `uploading` row
 * for the cleanup to find, and the concurrency tests run whole presign → PUT →
 * confirm chains so they can assert on `files`/`upload_batches`. All of them
 * answer the presigned PUT locally (`stubS3Puts`), so no bytes ever reach S3,
 * and the shared teardown resets the user. The real end-to-end upload against a
 * live bucket still lives in the validate tier
 * (upload-batches-and-quota.spec.ts).
 */
import { resetUserData, insertStorageUsage } from '@nexus/db/test-db';
import { PLAN_LIMITS, SOFT_LIMIT_MULTIPLIER } from '@nexus/db/plans';
import {
    MAX_CONCURRENT_FILES,
    MULTIPART_THRESHOLD,
    S3_CONNECTION_BUDGET,
} from '@/lib/upload/limits';
import { test, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { interceptTrpcCalls } from '../helpers/trpc';
import { seedResumableUpload } from '../helpers/uploadStore';
import {
    makeTextFiles,
    stubS3Puts,
    writeLargeFiles,
} from '../helpers/uploadStubs';

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

// The teardown belongs here rather than at the end of the test bodies that
// need it: the cancel-cleanup test asserts on an exact status array, so a
// failure that skipped cleanup would leave rows behind and fail every later run
// of this serial spec for the wrong reason.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

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

// Clear all used to release every row it swept, which for a multipart row
// meant aborting the S3 session and deleting its IndexedDB record — tidying
// the list silently destroyed an upload the queue was offering to resume.
test(
    'clear-all leaves an interrupted upload resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-clear-keeps-resumable'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);
        await expect(page.getByText('Drop files here to upload')).toBeVisible();

        await seedResumableUpload(page);
        await page.reload();
        await expect(
            page.getByText('Interrupted — re-add this file to resume')
        ).toBeVisible();

        await page.getByRole('button', { name: 'Clear all' }).click();
        await expect(page.getByText(/Selected Files/)).toBeHidden();

        // The record outlives the clear: a reload rehydrates the same row.
        await page.reload();
        await expect(page.getByText('big-shoot.zip')).toBeVisible();
        await expect(
            page.getByText('Interrupted — re-add this file to resume')
        ).toBeVisible();

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

// Uploads used to run strictly one at a time (#340): the queue awaited each
// file's whole presign → PUT → confirm chain before starting the next, so a
// 20-file selection spent its wall clock with one request in flight.
test(
    'a multi-file wave uploads concurrently, bounded by the pool size',
    { tag: ['@page:/dashboard/upload', '@uc:upload-concurrent-wave'] },
    async ({ page, db, seedUserId }) => {
        const puts = await stubS3Puts(page, { holdMs: 400 });
        const files = makeTextFiles(MAX_CONCURRENT_FILES * 2, 'queue-wave');

        await page.goto(PAGE_URL);
        await page.setInputFiles('input[type="file"]', files);
        await page
            .getByRole('button', { name: `Upload ${files.length} files` })
            .click();

        // The button state belongs to the wave, not to each file: once the
        // first file lands there are still four in flight and three queued, and
        // an "Uploading…" that dipped between files would re-render the Upload
        // button here.
        await expect(
            page.getByText('Uploaded', { exact: true }).first()
        ).toBeVisible({ timeout: 30_000 });
        await expect(
            page.getByRole('button', { name: /^Upload \d+ files?$/ })
        ).toHaveCount(0);

        await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(
            files.length,
            { timeout: 30_000 }
        );

        // More than one PUT open at a time (the whole point), never more than
        // the pool allows (which also keeps every mix inside the 6-connection
        // S3 budget, since a single-part file holds one connection).
        expect(puts.total).toBe(files.length);
        expect(puts.peak).toBe(MAX_CONCURRENT_FILES);

        // Concurrency must not fragment the batch: still one row per click,
        // still one shared key prefix.
        const batches = await db.query.uploadBatches.findMany({
            where: (b, { eq }) => eq(b.userId, seedUserId),
        });
        expect(batches).toHaveLength(1);
        const rows = await db.query.files.findMany({
            where: (f, { eq }) => eq(f.userId, seedUserId),
        });
        expect(rows).toHaveLength(files.length);
        for (const row of rows) {
            expect(row.status).toBe('available');
            expect(row.batchId).toBe(batches[0].id);
            expect(row.s3Key).toBe(
                `${seedUserId}/${batches[0].id}/${row.id}/${row.name}`
            );
        }
    }
);

// The one case the single-PUT tests can't reach: four files each opening their
// own chunk pool want 4 × MAX_CONCURRENT_CHUNKS connections, well past what a
// browser will give one host. The shared budget is what holds the line.
test(
    'four multipart files stay inside the shared S3 connection budget',
    { tag: ['@page:/dashboard/upload', '@uc:upload-multipart-budget'] },
    async ({ page }) => {
        // 400MB of fixtures and 44 part PUTs — well past the default budget.
        test.setTimeout(180_000);

        // Just over the multipart threshold, so each file is a handful of parts
        // rather than hundreds — the budget doesn't care how many follow.
        const large = await writeLargeFiles({
            count: MAX_CONCURRENT_FILES,
            prefix: 'queue-multipart',
            bytes: MULTIPART_THRESHOLD + 1024,
        });
        // Held long enough that the PUTs, not the browser's reading of 100MB
        // blobs, are what limits overlap. At a short hold the file reads become
        // the bottleneck and the observed peak drops below the budget, which
        // would make this pass without the semaphore doing anything.
        const puts = await stubS3Puts(page, { holdMs: 1200 });
        const inFlightRows = page.getByRole('button', {
            name: 'Cancel upload',
        });

        try {
            await page.goto(PAGE_URL);
            await page.setInputFiles('input[type="file"]', large.paths);
            await page
                .getByRole('button', {
                    name: `Upload ${MAX_CONCURRENT_FILES} files`,
                })
                .click();

            // Waits for every row to leave `uploading`, not for them to reach
            // `complete`: `files.multipart.complete` is a real S3 call that
            // verifies each part landed, and these PUTs were answered locally,
            // so the rows finish their PUT phase and then fail at completion.
            // Which is fine — the budget is a property of the PUTs, and by the
            // time no row is uploading, every part PUT has been made.
            await expect(inFlightRows).toHaveCount(MAX_CONCURRENT_FILES, {
                timeout: 60_000,
            });
            await expect(inFlightRows).toHaveCount(0, { timeout: 150_000 });

            // Exactly the budget, not merely under it: four files each wanting
            // MAX_CONCURRENT_CHUNKS would open 12 connections unbounded, and
            // landing on 6 shows the semaphore is what's holding them back
            // rather than some incidental bottleneck.
            expect(puts.peak).toBe(S3_CONNECTION_BUDGET);
        } finally {
            await large.cleanup();
        }
    }
);

// The chunk pool inside a single file is deliberately fail-fast — its siblings
// are parts of one object. A *file* pool has to be the opposite.
test(
    'one file failing mid-wave leaves its siblings running',
    { tag: ['@page:/dashboard/upload', '@uc:upload-failure-isolation'] },
    async ({ page }) => {
        const files = makeTextFiles(MAX_CONCURRENT_FILES + 1, 'queue-isolate');
        const doomed = files[1].name;
        await stubS3Puts(page, { holdMs: 200, failFor: doomed });

        await page.goto(PAGE_URL);
        await page.setInputFiles('input[type="file"]', files);
        await page
            .getByRole('button', { name: `Upload ${files.length} files` })
            .click();

        // The failed row keeps its own error state and Retry affordance...
        await expect(
            page.getByRole('button', { name: 'Retry upload' })
        ).toHaveCount(1, { timeout: 30_000 });
        // ...and every other file in the wave still finishes.
        await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(
            files.length - 1,
            { timeout: 30_000 }
        );
    }
);

test(
    'going offline mid-wave pauses the queue and reconnect drains it',
    { tag: ['@page:/dashboard/upload', '@uc:upload-offline-resume-wave'] },
    async ({ page, context }) => {
        // Long enough that the offline switch lands while PUTs are open.
        const puts = await stubS3Puts(page, { holdMs: 1500 });
        const files = makeTextFiles(MAX_CONCURRENT_FILES * 2, 'queue-offline');

        await page.goto(PAGE_URL);
        await page.setInputFiles('input[type="file"]', files);
        await page
            .getByRole('button', { name: `Upload ${files.length} files` })
            .click();

        await expect
            .poll(() => puts.inFlight, { timeout: 15_000 })
            .toBeGreaterThan(0);
        await context.setOffline(true);

        // Every unfinished row parks — the ones in flight and the ones still
        // queued behind them — so reconnect has a single set to resume.
        await expect(
            page.getByText('Paused — waiting for your connection').first()
        ).toBeVisible({ timeout: 15_000 });

        await context.setOffline(false);

        await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(
            files.length,
            { timeout: 45_000 }
        );
        // The resumed wave is still pool-bound, not a stampede of everything
        // that was paused.
        expect(puts.peak).toBeLessThanOrEqual(MAX_CONCURRENT_FILES);
    }
);

// Quota is the one failure that says something about the account rather than
// the file, so it's the one case where the pool gives up on the rest.
test(
    'the first quota rejection halts the wave',
    { tag: ['@page:/dashboard/upload', '@uc:upload-quota-halt'] },
    async ({ page, db, seedUserId }) => {
        // Park usage at 105% of starter: any positive size is over the cap.
        await insertStorageUsage(db, {
            userId: seedUserId,
            usedBytes: Math.floor(PLAN_LIMITS.starter * SOFT_LIMIT_MULTIPLIER),
            fileCount: 1,
        });
        const files = makeTextFiles(MAX_CONCURRENT_FILES * 2, 'queue-quota');

        await page.goto(PAGE_URL);
        await page.setInputFiles('input[type="file"]', files);
        await page
            .getByRole('button', { name: `Upload ${files.length} files` })
            .click();

        // Only the files already admitted attempt and fail...
        await expect(
            page.getByRole('button', { name: 'Retry upload' })
        ).toHaveCount(MAX_CONCURRENT_FILES, { timeout: 30_000 });
        // ...the rest are never started, so they stay queued.
        await expect(
            page.getByRole('button', {
                name: `Upload ${MAX_CONCURRENT_FILES} files`,
            })
        ).toBeVisible();

        // One message for the wave, not one per rejected file.
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);

        // The quota check runs before anything is minted, so nothing landed.
        const rows = await db.query.files.findMany({
            where: (f, { eq }) => eq(f.userId, seedUserId),
        });
        expect(rows).toHaveLength(0);
    }
);

test(
    'cancelling an in-flight upload strands no uploading row',
    { tag: ['@page:/dashboard/upload', '@uc:upload-cancel-cleanup'] },
    async ({ page, db, seedUserId }) => {
        // Stall the presigned PUT rather than failing it: the upload stays in
        // flight (so Cancel is the live affordance) and no object is ever
        // written.
        await stubS3Puts(page, { stall: true });

        const readStatuses = async () =>
            (
                await db.query.files.findMany({
                    where: (f, { eq }) => eq(f.userId, seedUserId),
                })
            ).map((f) => f.status);

        await page.goto(PAGE_URL);
        await page.setInputFiles('input[type="file"]', [FILE_A]);
        await page.getByRole('button', { name: 'Upload 1 file' }).click();

        // Cancel only cleans up what `files.upload` already minted, so wait for
        // the row before clicking — otherwise the test passes on a no-op.
        await expect
            .poll(readStatuses, { timeout: 15_000 })
            .toEqual(['uploading']);

        await page.getByRole('button', { name: 'Cancel upload' }).click();

        // The whole point of #330: no row left hidden in `uploading`, where no
        // list would ever show it and its S3 bytes would stay billed.
        await expect
            .poll(readStatuses, { timeout: 15_000 })
            .toEqual(['deleted']);
    }
);
