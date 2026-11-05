/**
 * The upload page as batch creation (#454): the batch an Upload click makes
 * is shown, named and aimed before the click, the one moment it can still be
 * changed without repairing it in the library afterwards. Uploads run
 * presign → PUT → confirm for real rows, with the PUT answered locally
 * (`stubS3Puts`) so no bytes reach S3; the batches are read from the DB.
 */
import {
    insertFile,
    insertUploadBatch,
    resetUserData,
} from '@nexus/db/test-db';
import { test, expect } from '../fixtures';
import {
    FILE_A,
    FILE_B,
    UPLOAD_PAGE_URL,
    uploadSpecUser,
} from '../helpers/uploadPage';
import { stubS3Puts, writeFolderTree } from '../helpers/uploadStubs';
import type { Page } from '@playwright/test';

// One worker for the file, so it signs up one user rather than one per worker
// its tests spread to. Not `serial`: no test hands state to the next.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('batch') });

test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

const getBatchSummary = (page: Page) =>
    page.getByRole('region', { name: 'Batch' });

async function pickExistingBatch(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'Existing batch…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Add to a batch' });
    await dialog.getByRole('radio', { name }).check();
    await dialog.getByRole('button', { name: 'Add to batch' }).click();
    await expect(dialog).toBeHidden();
}

async function uploadAndWait(page: Page, fileCount: number): Promise<void> {
    await page
        .getByRole('button', { name: `Upload ${fileCount} files` })
        .click();
    await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(
        fileCount,
        { timeout: 30_000 }
    );
}

test(
    'the batch summary names the batch after its folder, and the name typed there is the one it gets',
    { tag: ['@page:/dashboard/upload', '@uc:upload-batch-name-editable'] },
    async ({ page, db, seedUserId }) => {
        const tree = await writeFolderTree({
            name: 'card-1',
            files: {
                'IMG_0001.txt': 'frame one\n',
                '104CANON/IMG_0002.txt': 'frame two\n',
            },
        });
        try {
            await stubS3Puts(page);
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);

            const summary = getBatchSummary(page);
            const name = summary.getByRole('textbox', { name: 'Batch name' });
            await expect(name).toHaveValue('card-1');
            await expect(
                summary.getByText(/^2 files · .+ · in 1 folder$/)
            ).toBeVisible();
            await name.fill('Silva wedding');
            await uploadAndWait(page, 2);

            const batches = await db.query.uploadBatches.findMany({
                where: (b, { eq }) => eq(b.userId, seedUserId),
            });
            expect(batches.map((b) => [b.name, b.expectedFileCount])).toEqual([
                ['Silva wedding', 2],
            ]);
            // Renamed, the batch is still the folder: its name leaves the
            // paths as it does when the batch keeps it.
            const files = await db.query.files.findMany({
                where: (f, { eq }) => eq(f.userId, seedUserId),
            });
            expect(
                Object.fromEntries(files.map((f) => [f.name, f.subpath]))
            ).toEqual({ 'IMG_0001.txt': null, 'IMG_0002.txt': '104CANON' });
        } finally {
            await tree.cleanup();
        }
    }
);

test(
    'files uploaded into a batch the user already has join it, and it expects them',
    { tag: ['@page:/dashboard/upload', '@uc:upload-into-existing-batch'] },
    async ({ page, db, seedUserId }) => {
        const firstHalf = await insertUploadBatch(db, {
            userId: seedUserId,
            name: 'Silva wedding',
            expectedFileCount: 1,
        });
        await insertFile(db, {
            userId: seedUserId,
            batchId: firstHalf.id,
            name: 'IMG_0001.JPG',
        });
        await stubS3Puts(page);
        await page.goto(UPLOAD_PAGE_URL);
        const addFiles = () =>
            page.setInputFiles('[data-testid="file-input"]', [FILE_A, FILE_B]);
        const summary = getBatchSummary(page);
        const addingTo = summary.getByText('Adding to Silva wedding');

        // Clear all drops the pick with the files: the next drop starts
        // as a new batch, not aimed where the last one was.
        await addFiles();
        await pickExistingBatch(page, 'Silva wedding');
        await expect(addingTo).toBeVisible();
        await page.getByRole('button', { name: 'Clear all' }).click();
        await addFiles();
        await expect(
            summary.getByRole('button', { name: 'New batch' })
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(addingTo).toHaveCount(0);

        await pickExistingBatch(page, 'Silva wedding');
        await expect(addingTo).toBeVisible();
        await uploadAndWait(page, 2);

        const batches = await db.query.uploadBatches.findMany({
            where: (b, { eq }) => eq(b.userId, seedUserId),
        });
        expect(batches.map((b) => [b.id, b.expectedFileCount])).toEqual([
            [firstHalf.id, 3],
        ]);
        const files = await db.query.files.findMany({
            where: (f, { eq }) => eq(f.userId, seedUserId),
        });
        expect(files.map((f) => f.batchId)).toEqual([
            firstHalf.id,
            firstHalf.id,
            firstHalf.id,
        ]);
    }
);

test(
    'a dropped folder of shoots uploads as one batch per subfolder, its loose files in one named after it',
    { tag: ['@page:/dashboard/upload', '@uc:upload-batch-per-subfolder'] },
    async ({ page, db, seedUserId }) => {
        const tree = await writeFolderTree({
            name: 'library',
            files: {
                'index.txt': 'contents\n',
                'Silva/IMG_0001.txt': 'one\n',
                'Silva/RAW/IMG_0002.txt': 'two\n',
                'Costa/IMG_0003.txt': 'three\n',
            },
        });
        try {
            await stubS3Puts(page);
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);

            // Silva/RAW counts under Silva: the outline is the batch's top.
            const summary = getBatchSummary(page);
            await expect(
                summary.getByText(/^4 files · .+ · in 2 folders$/)
            ).toBeVisible();
            await summary.getByText('Show folders').click();
            await expect(
                summary.getByRole('list', { name: 'Folders' })
            ).toContainText('Silva2 files');
            await summary
                .getByRole('checkbox', { name: 'One batch per subfolder' })
                .click();
            await expect(
                summary.getByText(/^2 batches, each named after its subfolder/)
            ).toBeVisible();
            await uploadAndWait(page, 4);

            const batches = await db.query.uploadBatches.findMany({
                where: (b, { eq }) => eq(b.userId, seedUserId),
            });
            expect(
                Object.fromEntries(
                    batches.map((b) => [b.name, b.expectedFileCount])
                )
            ).toEqual({ library: 1, Silva: 2, Costa: 1 });
            const nameOf = new Map(batches.map((b) => [b.id, b.name]));
            const files = await db.query.files.findMany({
                where: (f, { eq }) => eq(f.userId, seedUserId),
            });
            expect(
                Object.fromEntries(
                    files.map((f) => [
                        f.name,
                        [nameOf.get(f.batchId!), f.subpath],
                    ])
                )
            ).toEqual({
                'index.txt': ['library', null],
                'IMG_0001.txt': ['Silva', null],
                'IMG_0002.txt': ['Silva', 'RAW'],
                'IMG_0003.txt': ['Costa', null],
            });
        } finally {
            await tree.cleanup();
        }
    }
);
