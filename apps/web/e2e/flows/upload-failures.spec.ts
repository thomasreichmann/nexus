/**
 * A file that fails to upload: its error state and retry, and the wave around
 * it carrying on. The isolation test's siblings confirm for real rows (PUT
 * answered locally by `stubS3Puts`); the retry test aborts `files.upload`, so
 * it creates nothing.
 */
import { resetUserData } from '@nexus/db/test-db';
import { MAX_CONCURRENT_FILES } from '@/lib/upload/limits';
import { test, expect } from '../fixtures';
import { interceptTrpcCalls } from '../helpers/trpc';
import { FILE_A, UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import { makeTextFiles, stubS3Puts } from '../helpers/uploadStubs';

// One user for the whole file, so its tests take turns on one worker
// (`default` overrides the config's fullyParallel). Nothing carries over
// between them, so a failure doesn't skip the rest the way `serial` would.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('failures') });

// In a hook rather than at the end of each test, so a failed test can't leave
// rows behind for the next one's exact counts.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

test(
    'failed upload shows the error state and retry re-attempts it',
    { tag: ['@page:/dashboard/upload', '@uc:upload-failure-retry'] },
    async ({ page }) => {
        const uploadCalls = await interceptTrpcCalls(page, 'files.upload');

        await page.goto(UPLOAD_PAGE_URL);

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

// The chunk pool inside a single file is deliberately fail-fast — its siblings
// are parts of one object. A *file* pool has to be the opposite.
test(
    'one file failing mid-wave leaves its siblings running',
    { tag: ['@page:/dashboard/upload', '@uc:upload-failure-isolation'] },
    async ({ page }) => {
        const files = makeTextFiles(MAX_CONCURRENT_FILES + 1, 'queue-isolate');
        const doomed = files[1].name;
        await stubS3Puts(page, { holdMs: 200, failFor: doomed });

        await page.goto(UPLOAD_PAGE_URL);
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
