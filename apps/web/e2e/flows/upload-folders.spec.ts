/**
 * Uploading folders: the batch a folder upload lands in, and what happens when
 * the same folder is dropped again. The uploads run presign → PUT → confirm for
 * real rows, with the PUT answered locally (`stubS3Puts`) so no bytes reach S3.
 */
import { resetUserData } from '@nexus/db/test-db';
import { test, expect } from '../fixtures';
import { FILE_A, UPLOAD_PAGE_URL, uploadSpecUser } from '../helpers/uploadPage';
import { stubS3Puts, writeFolderTree } from '../helpers/uploadStubs';

// One user for the whole file, so its tests take turns on one worker
// (`default` overrides the config's fullyParallel). Nothing carries over
// between them, so a failure doesn't skip the rest the way `serial` would.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('folders') });

// In a hook rather than at the end of each test, so a failed test can't leave
// rows behind for the next one's exact counts.
test.afterEach(async ({ db, seedUserId }) => {
    await resetUserData(db, seedUserId);
});

// Re-dropping is the natural recovery move after an interrupt or a "just to be
// sure" (#401), and it used to double-store and double-bill silently. The
// vault check runs on add, so the second drop queues nothing — the S3 stub's
// PUT count and the `files` table are the proof — until the user overrides,
// per row or all at once.
test(
    're-dropping an uploaded folder skips the copies until the user uploads anyway',
    { tag: ['@page:/dashboard/upload', '@uc:upload-duplicate-skip'] },
    async ({ page, db, seedUserId, consoleErrors }) => {
        const tree = await writeFolderTree({
            name: 'shoot-redrop',
            files: {
                'IMG_0001.txt': 'frame one\n',
                'day2/IMG_0002.txt': 'frame two\n',
            },
        });
        const countRows = () =>
            db.query.files.findMany({
                where: (f, { eq }) => eq(f.userId, seedUserId),
            });
        try {
            const puts = await stubS3Puts(page);
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);
            await page.getByRole('button', { name: 'Upload 2 files' }).click();
            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toHaveCount(2, { timeout: 30_000 });
            expect(puts.total).toBe(2);

            // Second drop of the same folder: both rows land flagged, nothing
            // is submittable, and the server never hears about them.
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);
            await expect(page.getByText('Selected Files (4)')).toBeVisible();
            await expect(
                page.getByText('2 files are already in your vault — skipped')
            ).toBeVisible();
            // exact: the bulk bar's sentence contains the row's line.
            await expect(
                page.getByText('Already in your vault — skipped', {
                    exact: true,
                })
            ).toHaveCount(2);
            await expect(
                page.getByRole('button', { name: /^Upload \d/ })
            ).toHaveCount(0);
            expect(puts.total).toBe(2);
            expect(await countRows()).toHaveLength(2);

            // Per-row override hands one row back to the Upload button; the
            // bulk override takes the rest.
            await page
                .getByRole('button', { name: 'Upload anyway', exact: true })
                .first()
                .click();
            await expect(
                page.getByRole('button', { name: 'Upload 1 file' })
            ).toBeVisible();
            await expect(
                page.getByText('1 file is already in your vault — skipped')
            ).toBeVisible();
            await page
                .getByRole('button', { name: 'Upload all anyway' })
                .click();
            await expect(
                page.getByText('Already in your vault — uploading anyway', {
                    exact: true,
                })
            ).toHaveCount(2);

            await page.getByRole('button', { name: 'Upload 2 files' }).click();
            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toHaveCount(4, { timeout: 30_000 });
            expect(puts.total).toBe(4);
            expect(await countRows()).toHaveLength(4);

            expect(consoleErrors).toEqual([]);
        } finally {
            await tree.cleanup();
        }
    }
);

// The folder is the shoot (#395): a whole-folder upload carries its name to
// the batch, which is the only label the file browser groups by. Driven
// through the hidden `webkitdirectory` input and all the way through the
// upload, so the header can be asserted on /dashboard/files.
test(
    'a whole-folder upload names its batch after the folder',
    {
        tag: [
            '@page:/dashboard/upload',
            '@page:/dashboard/files',
            '@uc:upload-folder-names-batch',
        ],
    },
    async ({ page, db, seedUserId }) => {
        const folderName = 'shoot-2026-08-18';
        const tree = await writeFolderTree({
            name: folderName,
            files: {
                'IMG_0001.txt': 'frame one\n',
                'day2/IMG_0002.txt': 'frame two\n',
            },
        });
        try {
            await stubS3Puts(page);
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);
            await page.getByRole('button', { name: 'Upload 2 files' }).click();

            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toHaveCount(2, { timeout: 30_000 });

            const batches = await db.query.uploadBatches.findMany({
                where: (b, { eq }) => eq(b.userId, seedUserId),
            });
            expect(batches).toHaveLength(1);
            expect(batches[0].name).toBe(folderName);

            // The header already renders `batchName`; this is what the name is
            // for, so assert the shoot is findable by it rather than by a date.
            await page.goto('/dashboard/files');
            await expect(
                page.getByRole('button', { name: new RegExp(folderName) })
            ).toBeVisible();
        } finally {
            await tree.cleanup();
        }
    }
);

// The naming rule's other half: a wave assembled from more than one gesture
// isn't about one folder, so it keeps the timestamp label rather than
// borrowing the name of whichever folder happened to be picked first.
test(
    'a wave mixing a folder with a loose file keeps the fallback batch name',
    {
        tag: ['@page:/dashboard/upload', '@uc:upload-mixed-wave-fallback-name'],
    },
    async ({ page, db, seedUserId }) => {
        const tree = await writeFolderTree({
            name: 'shoot-mixed',
            files: { 'IMG_0001.txt': 'frame one\n' },
        });
        try {
            await stubS3Puts(page);
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);
            await page.setInputFiles('[data-testid="file-input"]', [FILE_A]);
            await expect(page.getByText('Selected Files (2)')).toBeVisible();

            await page.getByRole('button', { name: 'Upload 2 files' }).click();
            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toHaveCount(2, { timeout: 30_000 });

            const batches = await db.query.uploadBatches.findMany({
                where: (b, { eq }) => eq(b.userId, seedUserId),
            });
            expect(batches).toHaveLength(1);
            expect(batches[0].name).toMatch(/^Upload \d{4}-\d{2}-\d{2} /);
        } finally {
            await tree.cleanup();
        }
    }
);
