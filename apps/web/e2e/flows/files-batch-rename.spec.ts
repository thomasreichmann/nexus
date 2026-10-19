/**
 * Renaming a batch (#408): an upload is named for when it ran, and a
 * photographer files a shoot by what it was. The new name has to reach
 * everywhere the batch is named and survive a reload.
 *
 * A dedicated user, so renaming its one batch can't disturb another spec's
 * library.
 */
import {
    type UploadBatch,
    insertFile,
    insertUploadBatch,
    deleteUserData,
} from '@nexus/db/test-db';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import {
    backToLibrary,
    batchCard,
    expectBatchOpen,
    openBatch,
} from '../helpers/fileBrowser';

const RENAME_USER: TestUser = {
    email: 'files-rename-e2e@test.local',
    password: 'files-rename-e2e-password-123',
    name: 'Files Rename E2E',
};
const STATE_PATH = 'e2e/.auth/files-rename.json';
const PAGE_URL = '/dashboard/files';
const NEW_NAME = 'Silva wedding';

const test = base.extend<NonNullable<unknown>, { batch: UploadBatch }>({
    batch: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const batch = await insertUploadBatch(db, {
                userId,
                name: 'Upload 2026-08-18 16:47:05',
            });
            await insertFile(db, {
                userId,
                batchId: batch.id,
                name: 'IMG_0001.JPG',
            });

            await use(batch);

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.use({
    dedicatedUserConfig: { user: RENAME_USER, statePath: STATE_PATH },
});

test(
    'renaming a batch from its menu renames it everywhere, and it stays renamed',
    { tag: ['@uc:files-batch-rename'] },
    async ({ page, batch }) => {
        await page.goto(PAGE_URL);
        await openBatch(page, batch.name);

        await page.getByRole('button', { name: 'Batch actions' }).click();
        await page.getByRole('menuitem', { name: 'Rename batch' }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Rename batch' });
        const field = dialog.getByLabel('Name');
        await expect(field).toHaveValue(batch.name);

        // Surrounding spaces are trimmed, not kept in the name.
        await field.fill(`  ${NEW_NAME}  `);
        await field.press('Enter');

        // The dialog closes onto the new name, not the old one.
        await expect(dialog).toBeHidden();
        await expectBatchOpen(page, NEW_NAME);

        await page.reload();
        await expectBatchOpen(page, NEW_NAME);
        await backToLibrary(page);
        await expect(batchCard(page, NEW_NAME)).toBeVisible();
        await expect(batchCard(page, batch.name)).toHaveCount(0);
    }
);
