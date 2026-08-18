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
import { fileName } from '../helpers/table';
import { interceptTrpcCalls } from '../helpers/trpc';
import {
    seedResumableUpload,
    readResumableUploadIds,
} from '../helpers/uploadStore';
import {
    makePngFile,
    makeTextFiles,
    stubS3Puts,
    writeFolderTree,
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

        await page.setInputFiles('[data-testid="file-input"]', [
            FILE_A,
            FILE_B,
        ]);

        await expect(page.getByText('Selected Files (2)')).toBeVisible();
        // fileName(): queue rows render names through MiddleTruncateName,
        // whose twin spans trip a bare getByText in strict mode.
        await expect(fileName(page, FILE_A.name)).toBeVisible();
        await expect(fileName(page, FILE_B.name)).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 2 files' })
        ).toBeVisible();
        // The summary tells the user how much room they actually have,
        // instead of the invented per-GB price it used to show.
        await expect(page.getByText('Storage available:')).toBeVisible();

        // Remove one queued file.
        await page.getByRole('button', { name: 'Remove' }).first().click();
        await expect(page.getByText('Selected Files (1)')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 1 file' })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

// A shoot is a folder (#388): selecting one queues the whole directory —
// nested files included, dotfile litter skipped. This drives the hidden
// `webkitdirectory` input directly; the native pickers and the drop-walk
// recursion can't be driven synthetically and are covered by unit tests.
test(
    'selecting a folder queues its files — nested included, hidden skipped',
    { tag: ['@page:/dashboard/upload', '@uc:upload-add-folder-queue'] },
    async ({ page, consoleErrors }) => {
        const tree = await writeFolderTree({
            name: 'shoot-2026-08-18',
            files: {
                'IMG_0001.txt': 'frame one\n',
                'day2/IMG_0002.txt': 'frame two\n',
                '.DS_Store': 'finder litter\n',
            },
        });
        try {
            await page.goto(PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);

            await expect(page.getByText('Selected Files (2)')).toBeVisible();
            await expect(fileName(page, 'IMG_0001.txt')).toBeVisible();
            await expect(fileName(page, 'IMG_0002.txt')).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Upload 2 files' })
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        } finally {
            await tree.cleanup();
        }
    }
);

test(
    'clear-all empties the pending queue',
    { tag: ['@page:/dashboard/upload', '@uc:upload-clear-queue'] },
    async ({ page }) => {
        await page.goto(PAGE_URL);

        await page.setInputFiles('[data-testid="file-input"]', [
            FILE_A,
            FILE_B,
        ]);
        await expect(page.getByText('Selected Files (2)')).toBeVisible();

        await page.getByRole('button', { name: 'Clear all' }).click();

        await expect(page.getByText(/Selected Files/)).toBeHidden();
    }
);

// A 50-file selection used to render 50 heavy rows into the page flow (#390):
// kilometric scroll, and every progress tick reconciled all of them. The list
// is now contained and virtualized — the page and the DOM stay bounded no
// matter how many files are queued.
test(
    'a 50-file selection stays contained — bounded page scroll, virtualized rows',
    {
        tag: [
            '@page:/dashboard/upload',
            '@uc:upload-large-selection-contained',
        ],
    },
    async ({ page, consoleErrors }) => {
        // One real image among the text files, so the tile's decode → resize →
        // cache pipeline runs in this tier and not only in a manual check.
        const image = makePngFile('queue-large-photo.png');
        const files = [image, ...makeTextFiles(49, 'queue-large')];

        await page.goto(PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', files);

        await expect(page.getByText('Selected Files (50)')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 50 files' })
        ).toBeVisible();

        // The image row's tile resolves to a generated thumbnail (a blob URL,
        // never the raw file).
        await expect(
            page
                .getByTestId('upload-queue-row')
                .filter({ hasText: image.name })
                .locator('img')
        ).toBeVisible();

        // The queue scrolls inside its own container, not the page…
        const queue = page.getByTestId('upload-queue');
        await expect(queue).toBeVisible();
        expect(
            await queue.evaluate((el) => el.scrollHeight > el.clientHeight)
        ).toBe(true);
        // …so the page stays within a few screens, where rendering every row
        // into the page flow grew it by a row-height per file.
        const viewportHeight = page.viewportSize()!.height;
        expect(
            await page.evaluate(() => document.documentElement.scrollHeight)
        ).toBeLessThan(viewportHeight * 3);

        // Virtualized: the DOM holds the visible window plus overscan, never
        // every row — DOM size scaling with the selection is what melted the
        // page.
        const renderedRows = await page.getByTestId('upload-queue-row').count();
        expect(renderedRows).toBeGreaterThan(0);
        expect(renderedRows).toBeLessThan(files.length);

        // Rows past the window really exist: scrolling the container to the
        // bottom materializes the last file.
        await queue.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        await expect(fileName(page, 'queue-large-48.txt')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

test(
    'an interrupted upload is detected on load and shown as resumable',
    { tag: ['@page:/dashboard/upload', '@uc:upload-resume-detect'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);
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
        await page.goto(PAGE_URL);
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
        await page.goto(PAGE_URL);
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
        await page.goto(PAGE_URL);
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

test(
    'failed upload shows the error state and retry re-attempts it',
    { tag: ['@page:/dashboard/upload', '@uc:upload-failure-retry'] },
    async ({ page }) => {
        const uploadCalls = await interceptTrpcCalls(page, 'files.upload');

        await page.goto(PAGE_URL);

        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
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
        await page.setInputFiles('[data-testid="file-input"]', files);
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

        // A clean wave earns the success line and a route to the files it
        // just created — the page is not a dead end.
        await expect(
            page.getByText('All files uploaded successfully!')
        ).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'View files' })
        ).toBeVisible();

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
            await page.setInputFiles('[data-testid="file-input"]', large.paths);
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
        await page.setInputFiles('[data-testid="file-input"]', files);
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

        // The failed row explains itself in words, not an HTTP status...
        await expect(page.getByText('Upload failed — try again')).toBeVisible();
        // ...and the summary owns the failure instead of claiming success.
        await expect(
            page.getByText(
                `${files.length - 1} of ${files.length} files uploaded — 1 failed`
            )
        ).toBeVisible();
        await expect(
            page.getByText('All files uploaded successfully!')
        ).toBeHidden();
    }
);

// The pool is re-entrant, so a wave in flight is not a locked door: files
// added while it runs queue as pending and a click folds them in.
test(
    'files added mid-wave join the running wave',
    {
        tag: [
            '@page:/dashboard/upload',
            '@uc:upload-add-mid-wave',
            '@uc:upload-wave-progress',
        ],
    },
    async ({ page }) => {
        const puts = await stubS3Puts(page, { holdMs: 2000 });
        const first = makeTextFiles(MAX_CONCURRENT_FILES + 2, 'queue-first');
        const late = makeTextFiles(2, 'queue-late');

        await page.goto(PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', first);
        await page
            .getByRole('button', { name: `Upload ${first.length} files` })
            .click();

        // The pool takes four; the overflow rows say they're waiting and
        // stay removable while they wait.
        await expect(page.getByText('Waiting to upload').first()).toBeVisible({
            timeout: 15_000,
        });
        // The wave is guaranteed live here (2s holds), so this is where the
        // aggregate header is assertable without racing the wave's end: the
        // per-row bars are useless at 50+ rows, the header is the summary.
        // Full phrase, so only the header line matches (its inner spans and
        // the "Uploading..." button each hold fragments).
        await expect(
            page.getByText(
                new RegExp(`Uploading — \\d+ of ${first.length} files`)
            )
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Remove' }).first()
        ).toBeVisible();

        // Adding files mid-wave re-arms the Upload button for just the new
        // rows; clicking it joins the wave already in flight.
        await page.setInputFiles('[data-testid="file-input"]', late);
        await page.getByRole('button', { name: 'Upload 2 files' }).click();

        await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(
            first.length + late.length,
            { timeout: 60_000 }
        );
        // Joining the wave respects the pool bound — no stampede.
        expect(puts.peak).toBeLessThanOrEqual(MAX_CONCURRENT_FILES);
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
        await page.setInputFiles('[data-testid="file-input"]', files);
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
        const files = makeTextFiles(MAX_CONCURRENT_FILES * 2, 'queue-quota');

        await page.goto(PAGE_URL);
        // Park usage at 105% of starter (any positive size is over the cap)
        // only after the page has cached a clear `getUsage`: with the #389
        // pre-flight in place, this stale-cache window is exactly where the
        // server-side halt still fires. The sidebar rendering the clear
        // snapshot is the proof the cache holds it — under full-tier load the
        // fetch can otherwise lose the race to the insert, and the pre-flight
        // would see the parked row and disable Upload.
        await expect(page.getByText('0 Bytes of')).toBeVisible();
        await page.setInputFiles('[data-testid="file-input"]', files);
        await insertStorageUsage(db, {
            userId: seedUserId,
            usedBytes: Math.floor(PLAN_LIMITS.starter * SOFT_LIMIT_MULTIPLIER),
            fileCount: 1,
        });
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

        // One message for the wave, not one per rejected file — and written
        // for people, not the raw byte counts the server logs.
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
        await expect(page.locator('[data-sonner-toast]')).toContainText(
            'Not enough storage'
        );

        // The quota check runs before anything is minted, so nothing landed.
        const rows = await db.query.files.findMany({
            where: (f, { eq }) => eq(f.userId, seedUserId),
        });
        expect(rows).toHaveLength(0);
    }
);

// Pre-flight quota (#389): the client already knows the usage and every
// queued file's size, so a doomed wave is refused before Upload is clicked
// instead of being discovered through a rejected wave.
test(
    'a selection that cannot fit disables Upload before the wave starts',
    { tag: ['@page:/dashboard/upload', '@uc:upload-preflight-quota'] },
    async ({ page, db, seedUserId }) => {
        // Park usage at the soft cap: any pending byte overflows what the
        // server would accept.
        await insertStorageUsage(db, {
            userId: seedUserId,
            usedBytes: Math.floor(PLAN_LIMITS.starter * SOFT_LIMIT_MULTIPLIER),
            fileCount: 1,
        });

        await page.goto(PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);

        await expect(page.getByText(/Not enough storage —/)).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 1 file' })
        ).toBeDisabled();

        // Removing the oversized selection clears the block.
        await page.getByRole('button', { name: 'Remove' }).click();
        await expect(page.getByText(/Not enough storage —/)).toBeHidden();
    }
);

test(
    'a selection past the limit but inside the grace band warns without blocking',
    { tag: ['@page:/dashboard/upload', '@uc:upload-preflight-quota'] },
    async ({ page, db, seedUserId }) => {
        // 10 bytes of the plan left: FILE_A projects past 100% but nowhere
        // near the 5% soft-cap band, so it may still upload.
        await insertStorageUsage(db, {
            userId: seedUserId,
            usedBytes: PLAN_LIMITS.starter - 10,
            fileCount: 1,
        });

        await page.goto(PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);

        await expect(
            page.getByText('This upload will put you over your storage limit.')
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 1 file' })
        ).toBeEnabled();

        // The sidebar bar shows the near-limit state rather than the calm
        // brand color at ~100% usage.
        await expect(
            page.locator('aside [data-usage-level="near-limit"]')
        ).toBeVisible();
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
        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
        await page.getByRole('button', { name: 'Upload 1 file' }).click();

        // Cancel only cleans up what `files.upload` already minted, so wait for
        // the row before clicking — otherwise the test passes on a no-op.
        await expect
            .poll(readStatuses, { timeout: 15_000 })
            .toEqual(['uploading']);

        await page.getByRole('button', { name: 'Cancel upload' }).click();
        // The X now opens the #389 confirmation guard; cleanup only fires
        // once the cancel is confirmed.
        await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Cancel upload' })
            .click();

        // The whole point of #330: no row left hidden in `uploading`, where no
        // list would ever show it and its S3 bytes would stay billed.
        await expect
            .poll(readStatuses, { timeout: 15_000 })
            .toEqual(['deleted']);
    }
);
