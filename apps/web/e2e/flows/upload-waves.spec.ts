/**
 * A multi-file wave: its concurrency bound, files joining it mid-flight, and
 * pausing it across a lost connection. The uploads run presign → PUT → confirm
 * for real rows, with the PUT answered locally (`stubS3Puts`) so no bytes reach
 * S3.
 */
import { resetUserData } from '@nexus/db/test-db';
import { MAX_CONCURRENT_FILES } from '@/lib/upload/limits';
import { test, expect } from '../fixtures';
import { UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import { makeTextFiles, stubS3Puts } from '../helpers/uploadStubs';

// One user for the whole file, so its tests take turns on one worker
// (`default` overrides the config's fullyParallel). Nothing carries over
// between them, so a failure doesn't skip the rest the way `serial` would.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('waves') });

// In a hook rather than at the end of each test, so a failed test can't leave
// rows behind for the next one's exact counts.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

// Uploads used to run strictly one at a time (#340): the queue awaited each
// file's whole presign → PUT → confirm chain before starting the next, so a
// 20-file selection spent its wall clock with one request in flight.
test(
    'a multi-file wave uploads concurrently, bounded by the pool size',
    { tag: ['@page:/dashboard/upload', '@uc:upload-concurrent-wave'] },
    async ({ page, db, seedUserId }) => {
        const puts = await stubS3Puts(page, { holdMs: 400 });
        const files = makeTextFiles(MAX_CONCURRENT_FILES * 2, 'queue-wave');

        await page.goto(UPLOAD_PAGE_URL);
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
        expect(batches[0].name).toMatch(/^Upload \d{4}-\d{2}-\d{2} /);
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

        await page.goto(UPLOAD_PAGE_URL);
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

        await page.goto(UPLOAD_PAGE_URL);
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
