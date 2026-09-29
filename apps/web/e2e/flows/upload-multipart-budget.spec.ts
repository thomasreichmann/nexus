/**
 * The shared S3 connection budget under multipart load. In its own file, as its
 * own user, because it is the tier's slowest test: every part's body crosses
 * CDP into the PUT stub one at a time, about 1.3 s per 10 MB part, so it runs
 * beside the other upload specs instead of inside their chain (#499).
 */
import {
    MAX_CONCURRENT_CHUNKS,
    MULTIPART_CHUNK_SIZE,
    MULTIPART_THRESHOLD,
    S3_CONNECTION_BUDGET,
} from '@/lib/upload/limits';
import { test, expect } from '../fixtures';
import { UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import {
    observeS3PutXhrs,
    stubS3Puts,
    writeLargeFiles,
} from '../helpers/uploadStubs';

test.use({ dedicatedUserConfig: uploadSpecUser('multipart') });

// The one case the single-PUT tests can't reach: several files each opening
// their own chunk pool want more connections than a browser will give one
// host. The shared budget is what holds the line.
test(
    'multipart files uploading together stay inside the shared S3 connection budget',
    { tag: ['@page:/dashboard/upload', '@uc:upload-multipart-budget'] },
    async ({ page }) => {
        test.setTimeout(150_000);

        // The fewest files whose chunk pools together overrun the budget
        // (3 × MAX_CONCURRENT_CHUNKS = 9 connections wanted against 6), each
        // exactly at the multipart threshold. Parts are what cost time here,
        // and this is the smallest load that still tests the budget.
        const fileCount =
            Math.floor(S3_CONNECTION_BUDGET / MAX_CONCURRENT_CHUNKS) + 1;
        const partCount =
            fileCount * Math.ceil(MULTIPART_THRESHOLD / MULTIPART_CHUNK_SIZE);
        const large = await writeLargeFiles({
            count: fileCount,
            prefix: 'queue-multipart',
            bytes: MULTIPART_THRESHOLD,
        });
        // Held so every part stays open long enough for the wave to queue up
        // behind the budget rather than trickle through it.
        const puts = await stubS3Puts(page, { holdMs: 1200 });
        // Counted in the page, not at the stub: a 10MB part reaches the route
        // handler seconds after it takes its permit, so the stub's view of the
        // overlap depends on the host (see `observeS3PutXhrs`).
        const putXhrs = await observeS3PutXhrs(page);

        try {
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="file-input"]', large.paths);
            await page
                .getByRole('button', { name: `Upload ${fileCount} files` })
                .click();
            await expect(
                page.getByRole('button', { name: 'Cancel upload' })
            ).toHaveCount(fileCount, { timeout: 60_000 });

            // Waits for every part PUT, not for the rows to finish: after the
            // last part, `files.multipart.complete` asks real S3 to assemble
            // parts the stub never stored, and retries its failure with
            // backoff for ~10 s that says nothing about the budget.
            await expect
                .poll(() => puts.total, { timeout: 120_000 })
                .toBeGreaterThanOrEqual(partCount);

            // Exactly the budget, not merely under it: unbounded, these files
            // would open 9 connections, and landing on 6 shows the semaphore is
            // what's holding them back rather than some incidental bottleneck.
            expect(await putXhrs.readPeak()).toBe(S3_CONNECTION_BUDGET);
            // And the network never saw more than that, however the transit
            // delay spread the PUTs out.
            expect(puts.peak).toBeLessThanOrEqual(S3_CONNECTION_BUDGET);
        } finally {
            await large.cleanup();
        }
    }
);
