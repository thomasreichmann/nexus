/**
 * Storage quota on the upload page: refusing a selection that can't fit,
 * warning inside the grace band, and halting a wave the server rejects. Each
 * test parks the user's usage with `insertStorageUsage`, and the teardown
 * zeroes it again.
 */
import { resetUserData, insertStorageUsage } from '@nexus/db/test-db';
import { PLAN_LIMITS, SOFT_LIMIT_MULTIPLIER } from '@nexus/db/plans';
import { MAX_CONCURRENT_FILES } from '@/lib/upload/limits';
import { test, expect } from '../fixtures';
import { FILE_A, UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import { makeTextFiles } from '../helpers/uploadStubs';

// One user for the whole file, so its tests take turns on one worker
// (`default` overrides the config's fullyParallel). Nothing carries over
// between them, so a failure doesn't skip the rest the way `serial` would.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('quota') });

// In a hook rather than at the end of each test, so a failed test can't leave
// its parked usage behind for the next one.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

// Quota is the one failure that says something about the account rather than
// the file, so it's the one case where the pool gives up on the rest.
test(
    'the first quota rejection halts the wave',
    { tag: ['@page:/dashboard/upload', '@uc:upload-quota-halt'] },
    async ({ page, db, seedUserId }) => {
        const files = makeTextFiles(MAX_CONCURRENT_FILES * 2, 'queue-quota');

        await page.goto(UPLOAD_PAGE_URL);
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

        await page.goto(UPLOAD_PAGE_URL);
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

        await page.goto(UPLOAD_PAGE_URL);
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
