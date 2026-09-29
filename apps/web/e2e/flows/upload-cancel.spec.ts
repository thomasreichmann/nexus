/**
 * Abandoning an upload in flight, by cancelling it or leaving the page, must
 * release the `uploading` row `files.upload` minted (#330). The PUT is stalled
 * locally (`stubS3Puts`) so the upload stays in flight and nothing reaches S3.
 */
import { resetUserData } from '@nexus/db/test-db';
import { test, expect } from '../fixtures';
import { FILE_A, UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import { stubS3Puts } from '../helpers/uploadStubs';

// One worker for the file, so it signs up one user rather than one per worker
// its tests spread to. Not `serial`: no test hands state to the next.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('cancel') });

// In a hook rather than at the end of the tests: both assert on an exact
// status array, so a failure that skipped cleanup would leave rows behind and
// fail the next test for the wrong reason.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

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

        await page.goto(UPLOAD_PAGE_URL);
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

// The upload engine is mounted on this page alone, so leaving mid-wave used to
// abort every in-flight PUT with no warning — an interrupted batch that looked
// complete (#398). Navigation now confirms first, and only while a wave is
// actually running.
test(
    'navigating away mid-wave asks for confirmation',
    { tag: ['@page:/dashboard/upload', '@uc:upload-nav-guard'] },
    async ({ page, db, seedUserId }) => {
        // Playwright's own navigations never surface beforeunload prompts, so
        // that half of the guard is asserted by dispatching a cancelable
        // synthetic event and reading back preventDefault.
        const isBeforeUnloadPrevented = () =>
            page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            });
        const sidebarFilesLink = page
            .getByRole('complementary')
            .getByRole('link', { name: 'Files' });
        const readStatuses = async () =>
            (
                await db.query.files.findMany({
                    where: (f, { eq }) => eq(f.userId, seedUserId),
                })
            ).map((f) => f.status);

        await stubS3Puts(page, { stall: true });
        await page.goto(UPLOAD_PAGE_URL);

        // A pending row is not a wave: no unload guard armed, and links
        // navigate with no prompt.
        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
        await expect(page.getByText(/Selected Files/)).toBeVisible();
        expect(await isBeforeUnloadPrevented()).toBe(false);
        await sidebarFilesLink.click();
        await expect(page).toHaveURL(/\/dashboard\/files/);

        // Start a wave and hold it in flight (the stubbed PUT never answers).
        await page.goto(UPLOAD_PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
        await page.getByRole('button', { name: 'Upload 1 file' }).click();
        await expect(
            page.getByRole('button', { name: 'Cancel upload' })
        ).toBeVisible();

        // Tab close / reload is guarded while the wave runs. Also wait for
        // the server row: the leave-anyway assertion below is about cleaning
        // up what `files.upload` minted, so it must exist before we leave.
        expect(await isBeforeUnloadPrevented()).toBe(true);
        await expect
            .poll(readStatuses, { timeout: 15_000 })
            .toEqual(['uploading']);

        // A sidebar click is intercepted: prompt shown, still on the page.
        await sidebarFilesLink.click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog.getByText('Leave this page?')).toBeVisible();
        await expect(page).toHaveURL(/\/dashboard\/upload/);

        // Staying keeps the wave in place.
        await dialog.getByRole('button', { name: 'Stay' }).click();
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/\/dashboard\/upload/);
        await expect(
            page.getByRole('button', { name: 'Cancel upload' })
        ).toBeVisible();

        // Confirming leaves for real — and releases the wave's server rows on
        // the way out, so nothing strands hidden in `uploading` (#330; the
        // Event Health check's stuck-uploads leg is what catches that).
        await sidebarFilesLink.click();
        await dialog.getByRole('button', { name: 'Leave anyway' }).click();
        await expect(page).toHaveURL(/\/dashboard\/files/);
        await expect
            .poll(readStatuses, { timeout: 15_000 })
            .toEqual(['deleted']);
    }
);
