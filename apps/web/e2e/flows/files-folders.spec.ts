/**
 * Structure inside a batch (#405, #455). Camera cards restart their numbering,
 * so a shoot of two cards holds two different IMG_0001.JPGs: a batch whose
 * files sit in more than one place groups them under collapsible folder rows,
 * and a batch whose files share one folder stays flat. Search matches a
 * folder's name too.
 *
 * A dedicated user, so the seeded batches are the whole library.
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
    fileItem,
    folderRows,
    openBatch,
} from '../helpers/fileBrowser';

const FOLDERS_USER: TestUser = {
    email: 'files-folders-e2e@test.local',
    password: 'files-folders-e2e-password-123',
    name: 'Files Folders E2E',
};
const STATE_PATH = 'e2e/.auth/files-folders.json';
const PAGE_URL = '/dashboard/files';

interface FolderLibrary {
    shoot: UploadBatch;
    flat: UploadBatch;
}

const test = base.extend<NonNullable<unknown>, { library: FolderLibrary }>({
    library: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const [shoot, flat] = await Promise.all([
                insertUploadBatch(db, { userId, name: 'Fitz - Loja 1' }),
                insertUploadBatch(db, {
                    userId,
                    name: 'Flat Shoot',
                    createdAt: new Date(Date.now() - 60_000),
                }),
            ]);
            const add = (
                batchId: string,
                name: string,
                subpath: string | null
            ) => insertFile(db, { userId, batchId, name, subpath });
            await Promise.all([
                add(shoot.id, 'notes.txt', null),
                add(shoot.id, 'IMG_0001.JPG', '104CANON'),
                add(shoot.id, 'IMG_0002.JPG', '104CANON'),
                add(shoot.id, 'IMG_0001.JPG', '105CANON'),
                // Everything in one folder: nothing for rows to tell apart.
                add(flat.id, 'DSC_0001.JPG', '100NIKON'),
                add(flat.id, 'DSC_0002.JPG', '100NIKON'),
            ]);

            await use({ shoot, flat });

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'default' });
test.use({
    dedicatedUserConfig: { user: FOLDERS_USER, statePath: STATE_PATH },
});

test(
    'a batch with subfolders groups its files under folder rows; a one-folder batch stays flat',
    { tag: ['@page:/dashboard/files', '@uc:files-subfolder-grouping'] },
    async ({ page, library }) => {
        await page.goto(PAGE_URL);
        await openBatch(page, library.shoot.name);

        // Top-level files first, then the folders in natural order. The first
        // row starts open; the rest load nothing until opened.
        const rows = folderRows(page);
        await expect(rows).toHaveText([
            /Top level.*1 file/,
            /104CANON.*2 files/,
            /105CANON.*1 file/,
        ]);
        await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
        await expect(fileItem(page, 'notes.txt')).toBeVisible();
        await expect(fileItem(page, 'IMG_0001.JPG')).toHaveCount(0);

        await backToLibrary(page);
        await openBatch(page, library.flat.name);
        await expect(rows).toHaveCount(0);
        await expect(fileItem(page, 'DSC_0001.JPG')).toBeVisible();
        await expect(fileItem(page, 'DSC_0002.JPG')).toBeVisible();
    }
);

test(
    'a folder row opens and closes, and the viewer names the folder',
    { tag: ['@uc:files-batch-expand-collapse'] },
    async ({ page, library }) => {
        await page.goto(PAGE_URL);
        await openBatch(page, library.shoot.name);

        const folder = page.getByRole('button', { name: '104CANON, 2 files' });
        await expect(folder).toHaveAttribute('aria-expanded', 'false');
        await folder.click();
        await expect(folder).toHaveAttribute('aria-expanded', 'true');
        await expect(fileItem(page, 'IMG_0002.JPG')).toBeVisible();
        // 105CANON's IMG_0001 stays closed away: one of the two shows.
        await expect(fileItem(page, 'IMG_0001.JPG')).toHaveCount(1);

        // One "Open" per file: the tile's expand button stays out of the
        // accessibility tree until a selection makes a click select.
        await fileItem(page, 'IMG_0002.JPG')
            .getByRole('button', { name: 'Open IMG_0002.JPG' })
            .click();
        const viewer = page.getByRole('dialog', { name: 'IMG_0002.JPG' });
        await expect(viewer.getByText('2 of 2 · 104CANON')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(viewer).toBeHidden();

        await folder.click();
        await expect(folder).toHaveAttribute('aria-expanded', 'false');
        await expect(fileItem(page, 'IMG_0002.JPG')).toHaveCount(0);
    }
);

test(
    'search matches a subfolder and opens its batch on that folder’s files',
    { tag: ['@uc:files-search-subfolder'] },
    async ({ page, library }) => {
        const shootCard = batchCard(page, library.shoot.name);
        await page.goto(PAGE_URL);
        await expect(shootCard).toBeVisible();

        await page
            .getByPlaceholder('Search files and batches')
            .fill('105canon');
        await expect(batchCard(page, library.flat.name)).toBeHidden();
        await expect(shootCard.getByText(/1 of 4 files match/)).toBeVisible();

        await openBatch(page, library.shoot.name);
        await expect(folderRows(page)).toHaveText([
            /105CANON.*1 of 1 file match/,
        ]);
        await expect(fileItem(page, 'IMG_0001.JPG')).toBeVisible();
        await expect(fileItem(page, 'notes.txt')).toHaveCount(0);
    }
);
