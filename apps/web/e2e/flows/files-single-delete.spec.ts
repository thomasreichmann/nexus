/**
 * Row-menu delete asks before it acts (#403).
 *
 * Before the guard, the menu's Delete fired the mutation on click — one pixel
 * under the only other item on an archived row, with no way back from the UI.
 * This spec pins the second step: the dialog names the file, backing out
 * leaves the row in place, and only confirming removes it.
 *
 * Runs as its own dedicated user so the delete can't perturb
 * `files-browser.spec.ts`'s exact counts. Deletion runs for real: it is a soft
 * delete, so the seeded keys need no objects behind them.
 */
import { expect } from '../fixtures';
import { withSeededFiles } from '../fixtures/seeded-files';
import { type TestUser } from '../helpers/auth';
import {
    confirmSingleDelete,
    openSingleDeleteDialog,
} from '../helpers/fileBrowser';
import { fileName } from '../helpers/table';

const SINGLE_DELETE_USER: TestUser = {
    email: 'files-single-delete-e2e@test.local',
    password: 'files-single-delete-e2e-password-123',
    name: 'Files Single Delete E2E',
};
const STATE_PATH = 'e2e/.auth/files-single-delete.json';
const PAGE_URL = '/dashboard/files';

// Two rows: one to delete, one to prove the delete stayed scoped.
const test = withSeededFiles(2);

test.use({
    dedicatedUserConfig: { user: SINGLE_DELETE_USER, statePath: STATE_PATH },
});

test(
    'row-menu delete names the file and only removes it on confirm',
    { tag: ['@page:/dashboard/files', '@uc:files-delete-single'] },
    async ({ page, seededFiles }) => {
        const [target, bystander] = seededFiles;

        await page.goto(PAGE_URL);
        await expect(fileName(page, target.name)).toBeVisible();

        // Backing out: the dialog shows which file is at stake, and Keep file
        // leaves the row exactly where it was.
        const dialog = await openSingleDeleteDialog(page, target.name);
        await expect(
            dialog.getByText(target.name).filter({ visible: true }).first()
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Keep file' }).click();
        await expect(dialog).toBeHidden();
        await expect(fileName(page, target.name)).toBeVisible();

        // Confirming is what removes the row — and only that row.
        await confirmSingleDelete(page, target.name);
        await expect(fileName(page, target.name)).toBeHidden({
            timeout: 10_000,
        });
        await expect(fileName(page, bystander.name)).toBeVisible();
    }
);
