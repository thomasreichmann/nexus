/**
 * Moving files between batches and merging batches (#453): a retry, a mixed
 * wave or a re-dropped shoot splits what the photographer thinks of as one
 * batch, and these put it back together. Only `batch_id` changes, so what
 * the specs check is where the files show up: under the target, without a
 * reload, with an emptied source gone from the library.
 *
 * A dedicated user, with each test seeding its own batches: every test here
 * moves files around, so none can lean on another's leftovers.
 */
import {
    insertFile,
    insertUploadBatch,
    deleteUserData,
} from '@nexus/db/test-db';
import { type Locator, type Page } from '@playwright/test';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import {
    backToLibrary,
    batchCard,
    expectBatchOpen,
    fileItem,
    openBatch,
    openBatchMenuItem,
    openRowMenu,
    toggleFile,
} from '../helpers/fileBrowser';

const MOVE_USER: TestUser = {
    email: 'files-move-e2e@test.local',
    password: 'files-move-e2e-password-123',
    name: 'Files Move E2E',
};
const STATE_PATH = 'e2e/.auth/files-move.json';
const PAGE_URL = '/dashboard/files';

/** Batch name → its files' names; `null` seeds legacy Ungrouped files. */
type Library = [name: string | null, files: string[]][];

const test = base.extend<{ seed: (library: Library) => Promise<void> }>({
    seed: async ({ db, dedicatedUser }, use) => {
        const userId = dedicatedUser!.userId;
        await use(async (library) => {
            for (const [name, files] of library) {
                const batch = name
                    ? await insertUploadBatch(db, { userId, name })
                    : null;
                for (const file of files) {
                    await insertFile(db, {
                        userId,
                        batchId: batch?.id ?? null,
                        name: file,
                    });
                }
            }
        });
        await deleteUserData(db, userId);
    },
});

test.use({
    dedicatedUserConfig: { user: MOVE_USER, statePath: STATE_PATH },
});

/** The open dialog: pick the target batch, then confirm with `action`. */
async function moveInto(
    dialog: Locator,
    target: string,
    action: 'Move' | 'Merge'
): Promise<void> {
    await dialog
        .getByRole('searchbox', { name: 'Search batches' })
        .fill(target);
    await dialog.getByRole('radio', { name: target }).check();
    await dialog.getByRole('button', { name: action, exact: true }).click();
    // A move holds the dialog through the mutation and the whole file
    // list's refetch, two round trips that under a full parallel run can
    // take more than the default 5 s between them.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

function moveDialog(page: Page): Locator {
    return page.getByRole('alertdialog', { name: 'Move to batch' });
}

function mergeDialog(page: Page): Locator {
    return page.getByRole('alertdialog', { name: 'Merge into batch' });
}

test(
    'moving picked files and then one from its menu puts them under the target, and the emptied batch leaves',
    { tag: ['@uc:files-move-files'] },
    async ({ page, seed }) => {
        await seed([
            ['Ana shoot', ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG']],
            ['Ana shoot, part 2', ['IMG_0004.JPG']],
        ]);
        await page.goto(PAGE_URL);
        await openBatch(page, 'Ana shoot');

        await toggleFile(page, 'IMG_0001.JPG');
        await toggleFile(page, 'IMG_0002.JPG');
        await page.getByRole('button', { name: 'Move to…' }).click();
        await moveInto(moveDialog(page), 'Ana shoot, part 2', 'Move');

        await expect(fileItem(page, 'IMG_0001.JPG')).toHaveCount(0);
        await expect(fileItem(page, 'IMG_0002.JPG')).toHaveCount(0);
        await expect(fileItem(page, 'IMG_0003.JPG')).toBeVisible();
        // The bar went with the files it acted on.
        await expect(
            page.getByRole('button', { name: 'Clear selection' })
        ).toBeHidden();

        await openRowMenu(page, 'IMG_0003.JPG');
        await page.getByRole('menuitem', { name: 'Move to…' }).click();
        await moveInto(moveDialog(page), 'Ana shoot, part 2', 'Move');

        // Its last file gone, the batch closes and drops out of the library.
        await expect(page.locator('[data-phase="library"]')).toHaveCount(1);
        await expect(batchCard(page, 'Ana shoot')).toHaveCount(0);
        await openBatch(page, 'Ana shoot, part 2');
        for (const name of [
            'IMG_0001.JPG',
            'IMG_0002.JPG',
            'IMG_0003.JPG',
            'IMG_0004.JPG',
        ]) {
            await expect(fileItem(page, name)).toBeVisible();
        }
    }
);

test(
    'merging a batch from its menu opens the target with every file, and Ungrouped merges too',
    { tag: ['@uc:files-batch-merge'] },
    async ({ page, seed }) => {
        await seed([
            ['Silva wedding', ['DSC_0100.JPG']],
            ['Silva wedding (remainder)', ['DSC_0101.JPG']],
            [null, ['loose-scan.tif']],
        ]);
        await page.goto(PAGE_URL);
        await openBatch(page, 'Silva wedding (remainder)');

        await openBatchMenuItem(page, 'Merge into…');
        await moveInto(mergeDialog(page), 'Silva wedding', 'Merge');

        await expectBatchOpen(page, 'Silva wedding');
        await expect(fileItem(page, 'DSC_0100.JPG')).toBeVisible();
        await expect(fileItem(page, 'DSC_0101.JPG')).toBeVisible();
        await expect(batchCard(page, 'Silva wedding (remainder)')).toHaveCount(
            0
        );

        await backToLibrary(page);
        await openBatch(page, 'Ungrouped');
        await openBatchMenuItem(page, 'Merge into…');
        await moveInto(mergeDialog(page), 'Silva wedding', 'Merge');

        await expectBatchOpen(page, 'Silva wedding');
        await expect(fileItem(page, 'loose-scan.tif')).toBeVisible();
        await expect(batchCard(page, 'Ungrouped')).toHaveCount(0);
    }
);

test(
    // By batch id on the server, so a batch bigger than its loaded pages
    // merges whole: services/files.integration.test.ts pins that, not this.
    'Move to… on a whole-batch selection merges the batch and opens the target',
    { tag: ['@uc:files-batch-merge'] },
    async ({ page, seed }) => {
        await seed([
            ['Costa portraits', ['PORTRAIT_01.JPG']],
            ['Costa portraits, retry', ['PORTRAIT_02.JPG', 'PORTRAIT_03.JPG']],
        ]);
        await page.goto(PAGE_URL);
        await openBatch(page, 'Costa portraits, retry');

        await page.getByRole('checkbox', { name: 'Select all 2' }).click();
        await page.getByRole('button', { name: 'Move to…' }).click();
        await moveInto(mergeDialog(page), 'Costa portraits', 'Merge');

        await expectBatchOpen(page, 'Costa portraits');
        for (const name of [
            'PORTRAIT_01.JPG',
            'PORTRAIT_02.JPG',
            'PORTRAIT_03.JPG',
        ]) {
            await expect(fileItem(page, name)).toBeVisible();
        }
        await expect(batchCard(page, 'Costa portraits, retry')).toHaveCount(0);
    }
);
