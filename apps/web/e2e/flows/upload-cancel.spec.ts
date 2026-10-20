/**
 * Ending an upload in flight, by cancelling it or by signing out, must release
 * the `uploading` row `files.upload` minted (#330). The PUT is stalled locally
 * (`stubS3Puts`) so the upload stays in flight and nothing reaches S3.
 */
import {
    deleteUserByEmail,
    findUserByEmail,
    resetUserData,
    type DB,
} from '@nexus/db/test-db';
import { test, expect } from '../fixtures';
import { signUpViaUi, uniqueTestEmail } from '../helpers/auth';
import { FILE_A, UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import { stubS3Puts } from '../helpers/uploadStubs';

// One worker for the file, so it signs up one user rather than one per worker
// its tests spread to. Not `serial`: no test hands state to the next.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('cancel') });

// In a hook rather than at the end of the tests: both assert on an exact
// status array, so a failure that skipped cleanup would leave rows behind and
// fail a rerun for the wrong reason.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

async function readStatuses(db: DB, userId: string) {
    const files = await db.query.files.findMany({
        where: (f, { eq }) => eq(f.userId, userId),
    });
    return files.map((f) => f.status);
}

test(
    'cancelling an in-flight upload strands no uploading row',
    { tag: ['@page:/dashboard/upload', '@uc:upload-cancel-cleanup'] },
    async ({ page, db, seedUserId }) => {
        // Stall the presigned PUT rather than failing it: the upload stays in
        // flight (so Cancel is the live affordance) and no object is ever
        // written.
        await stubS3Puts(page, { stall: true });
        const statuses = () => readStatuses(db, seedUserId);

        await page.goto(UPLOAD_PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
        await page.getByRole('button', { name: 'Upload 1 file' }).click();

        // Cancel only cleans up what `files.upload` already minted, so wait for
        // the row before clicking — otherwise the test passes on a no-op.
        await expect.poll(statuses, { timeout: 15_000 }).toEqual(['uploading']);

        await page.getByRole('button', { name: 'Cancel upload' }).click();
        // The X now opens the #389 confirmation guard; cleanup only fires
        // once the cancel is confirmed.
        await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Cancel upload' })
            .click();

        // The whole point of #330: no row left hidden in `uploading`, where no
        // list would ever show it and its S3 bytes would stay billed.
        await expect.poll(statuses, { timeout: 15_000 }).toEqual(['deleted']);
    }
);

// A wave outlives the upload page now (#399), so sign-out is what ends it: the
// next account to sign in on this tab must not inherit it, and its server rows
// must be released while the session can still authorize that.
test.describe('signing out', () => {
    // A user and session of its own: signing out revokes the session, which
    // must not be the one the dedicated user's state file holds.
    const SIGN_OUT_USER = {
        email: uniqueTestEmail('upload-sign-out'),
        password: 'upload-sign-out-e2e-password-123',
        name: 'Upload Sign Out E2E',
    };
    test.use({ storageState: { cookies: [], origins: [] } });
    test.afterAll(async ({ db }) => {
        await deleteUserByEmail(db, SIGN_OUT_USER.email);
    });

    test(
        'signing out mid-wave ends it and strands no uploading row',
        { tag: ['@page:/dashboard/upload', '@uc:upload-sign-out-clears'] },
        async ({ page, db }) => {
            await stubS3Puts(page, { stall: true });
            await signUpViaUi(page, SIGN_OUT_USER);
            const user = await findUserByEmail(db, SIGN_OUT_USER.email);

            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
            await page.getByRole('button', { name: 'Upload 1 file' }).click();
            await expect
                .poll(() => readStatuses(db, user!.id), { timeout: 15_000 })
                .toEqual(['uploading']);

            await page.getByRole('button', { name: 'User menu' }).click();
            await page.getByRole('menuitem', { name: 'Sign out' }).click();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // Released before the session ended, not eventually: once the
            // landing page shows, the row is already out of `uploading`.
            expect(await readStatuses(db, user!.id)).toEqual(['deleted']);
        }
    );
});
