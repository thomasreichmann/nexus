/**
 * Row-menu delete asks before it acts (#403).
 *
 * Before the guard, the menu's Delete fired the mutation on click — one pixel
 * under the only other item on an archived row, with no way back from the UI.
 * This spec pins the second step: the dialog names the file, backing out
 * leaves the row in place, and only confirming removes it.
 *
 * And a file deleted on its own leaves the selection (#477). It used to stay
 * picked, and the bulk delete after it sent its id again and rolled back.
 *
 * Runs as its own dedicated user so the delete can't perturb
 * `files-browser.spec.ts`'s exact counts. Deletion runs for real: it is a soft
 * delete, so the seeded keys need no objects behind them.
 */
import { type Page } from '@playwright/test';
import { expect } from '../fixtures';
import { withSeededFiles } from '../fixtures/seeded-files';
import { type TestUser } from '../helpers/auth';
import {
    confirmBulkDelete,
    confirmSingleDelete,
    fileItem,
    openBatch,
    openRowMenu,
    openSingleDeleteDialog,
    toggleFile,
} from '../helpers/fileBrowser';
import { isTrpcRequest } from '../helpers/trpc';

const SINGLE_DELETE_USER: TestUser = {
    email: 'files-single-delete-e2e@test.local',
    password: 'files-single-delete-e2e-password-123',
    name: 'Files Single Delete E2E',
};
const STATE_PATH = 'e2e/.auth/files-single-delete.json';
const PAGE_URL = '/dashboard/files';

// Each test takes its own files, since a worker's tests share them: two for
// the confirm, three for the menu's delete mid-selection, two for the
// viewer's, two for the delete in flight.
const test = withSeededFiles(9);

test.use({
    dedicatedUserConfig: { user: SINGLE_DELETE_USER, statePath: STATE_PATH },
});

test(
    'row-menu delete names the file and only removes it on confirm',
    { tag: ['@page:/dashboard/files', '@uc:files-delete-single'] },
    async ({ page, seededFiles }) => {
        const [target, bystander] = seededFiles;

        await page.goto(PAGE_URL);
        await openBatch(page, 'Ungrouped');
        await expect(fileItem(page, target.name)).toBeVisible();

        // Backing out: the dialog shows which file is at stake, and Keep file
        // leaves the file exactly where it was.
        const dialog = await openSingleDeleteDialog(page, target.name);
        await expect(
            dialog.getByText(target.name).filter({ visible: true }).first()
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Keep file' }).click();
        await expect(dialog).toBeHidden();
        await expect(fileItem(page, target.name)).toBeVisible();

        // Every file's menu shares the one dialog (#477): asked from another
        // file, it names that one.
        await openSingleDeleteDialog(page, bystander.name);
        await expect(
            dialog.getByText(bystander.name).filter({ visible: true }).first()
        ).toBeVisible();
        await expect(dialog.getByText(target.name)).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Keep file' }).click();
        await expect(dialog).toBeHidden();

        // Confirming is what removes the file — and only that file.
        await confirmSingleDelete(page, target.name);
        await expect(fileItem(page, target.name)).toBeHidden({
            timeout: 10_000,
        });
        await expect(fileItem(page, bystander.name)).toBeVisible();
    }
);

test(
    'a file deleted from its menu leaves the selection, and the bulk delete after it goes through',
    {
        tag: [
            '@page:/dashboard/files',
            '@uc:files-delete-single-mid-selection',
        ],
    },
    async ({ page, seededFiles }) => {
        const [deleted, picked, bystander] = seededFiles.slice(2, 5);

        await page.goto(PAGE_URL);
        await openBatch(page, 'Ungrouped');
        await toggleFile(page, deleted.name);
        await toggleFile(page, picked.name);
        await expect(selectedCount(page)).toHaveText('2 selected');

        await confirmSingleDelete(page, deleted.name);
        await expect(fileItem(page, deleted.name)).toBeHidden({
            timeout: 10_000,
        });
        await expect(selectedCount(page)).toHaveText('1 selected');

        await confirmBulkDelete(page, 1);
        await expect(fileItem(page, picked.name)).toBeHidden({
            timeout: 10_000,
        });
        await expect(fileItem(page, bystander.name)).toBeVisible();
    }
);

test(
    'a file deleted from the viewer leaves the selection',
    {
        tag: [
            '@page:/dashboard/files',
            '@uc:files-delete-single-mid-selection',
        ],
    },
    async ({ page, seededFiles }) => {
        const [deleted, picked] = seededFiles.slice(5, 7);

        await page.goto(PAGE_URL);
        await openBatch(page, 'Ungrouped');
        await toggleFile(page, deleted.name);
        await toggleFile(page, picked.name);

        await fileItem(page, deleted.name)
            .getByRole('button', { name: `Open ${deleted.name}` })
            .click();
        const viewer = page.getByRole('dialog');
        // Deleting moves the viewer on to a neighbour, which waits for the
        // open to settle.
        await expect(viewer).toHaveAttribute('data-viewer-phase', 'open');
        await viewer.getByRole('button', { name: 'Delete file' }).click();
        await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Delete file' })
            .click();
        await expect(
            viewer.getByText('1 selected', { exact: true })
        ).toBeVisible({ timeout: 10_000 });

        await page.keyboard.press('Escape');
        await expect(viewer).toBeHidden();
        await expect(fileItem(page, deleted.name)).toBeHidden();
        await expect(selectedCount(page)).toHaveText('1 selected');
    }
);

test(
    'a delete on its way holds back its own file’s Delete, not another’s',
    { tag: ['@page:/dashboard/files', '@uc:files-delete-single'] },
    async ({ page, seededFiles }) => {
        const [deleting, other] = seededFiles.slice(7, 9);
        // Held until both menus have been looked at.
        let release = () => {};
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(
            (url) => isTrpcRequest(url.href, 'files.delete'),
            async (route) => {
                await released;
                await route.continue();
            }
        );

        await page.goto(PAGE_URL);
        await openBatch(page, 'Ungrouped');
        await confirmSingleDelete(page, deleting.name);

        const deleteItem = page.getByRole('menuitem', { name: 'Delete' });
        await openRowMenu(page, deleting.name);
        await expect(deleteItem).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(deleteItem).toHaveCount(0);
        await openRowMenu(page, other.name);
        await expect(deleteItem).toBeEnabled();
        await page.keyboard.press('Escape');

        release();
        await expect(fileItem(page, deleting.name)).toBeHidden({
            timeout: 10_000,
        });
        await expect(fileItem(page, other.name)).toBeVisible();
    }
);

/** The selection bar's "N selected", once the viewer is out of the way. */
function selectedCount(page: Page) {
    return page.getByText(/^\d+ selected$/);
}
