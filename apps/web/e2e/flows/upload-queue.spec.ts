/**
 * Building and clearing the upload queue, before anything uploads. These tests
 * only select files, so they write no rows and need no teardown.
 *
 * The other upload flows live beside this file as `upload-*.spec.ts`, one
 * dedicated user each, so they run on parallel workers (#499).
 */
import { test, expect } from '../fixtures';
import { fileName } from '../helpers/table';
import {
    FILE_A,
    FILE_B,
    UPLOAD_PAGE_URL,
    uploadSpecUser,
} from '../helpers/uploadPage';
import {
    makePngFile,
    makeTextFiles,
    writeFolderTree,
} from '../helpers/uploadStubs';

// One worker for the file, so it signs up one user rather than one per worker
// its tests spread to. Not `serial`: no test hands state to the next.
test.describe.configure({ mode: 'default' });
test.use({ dedicatedUserConfig: uploadSpecUser('queue') });

test(
    'adding files builds the queue with names, sizes, and a remove control',
    { tag: ['@page:/dashboard/upload', '@uc:upload-add-files-queue'] },
    async ({ page, consoleErrors }) => {
        await page.goto(UPLOAD_PAGE_URL);

        await page.setInputFiles('[data-testid="file-input"]', [
            FILE_A,
            FILE_B,
        ]);

        await expect(page.getByText('Selected Files (2)')).toBeVisible();
        // fileName(): queue rows render names through MiddleTruncateName,
        // whose twin spans trip a bare getByText in strict mode.
        await expect(fileName(page, FILE_A.name)).toBeVisible();
        await expect(fileName(page, FILE_B.name)).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 2 files' })
        ).toBeVisible();
        // The summary tells the user how much room they actually have,
        // instead of the invented per-GB price it used to show.
        await expect(page.getByText('Storage available:')).toBeVisible();

        // Remove one queued file.
        await page.getByRole('button', { name: 'Remove' }).first().click();
        await expect(page.getByText('Selected Files (1)')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 1 file' })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

// A shoot is a folder (#388): selecting one queues the whole directory —
// nested files included, dotfile litter skipped. This drives the hidden
// `webkitdirectory` input directly; the native pickers and the drop-walk
// recursion can't be driven synthetically and are covered by unit tests.
test(
    'selecting a folder queues its files — nested included, hidden skipped',
    { tag: ['@page:/dashboard/upload', '@uc:upload-add-folder-queue'] },
    async ({ page, consoleErrors }) => {
        const tree = await writeFolderTree({
            name: 'shoot-2026-08-18',
            files: {
                'IMG_0001.txt': 'frame one\n',
                'day2/IMG_0002.txt': 'frame two\n',
                '.DS_Store': 'finder litter\n',
            },
        });
        try {
            await page.goto(UPLOAD_PAGE_URL);
            await page.setInputFiles('[data-testid="folder-input"]', tree.dir);

            await expect(page.getByText('Selected Files (2)')).toBeVisible();
            await expect(fileName(page, 'IMG_0001.txt')).toBeVisible();
            await expect(fileName(page, 'IMG_0002.txt')).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Upload 2 files' })
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        } finally {
            await tree.cleanup();
        }
    }
);

test(
    'clear-all empties the pending queue',
    { tag: ['@page:/dashboard/upload', '@uc:upload-clear-queue'] },
    async ({ page }) => {
        await page.goto(UPLOAD_PAGE_URL);

        await page.setInputFiles('[data-testid="file-input"]', [
            FILE_A,
            FILE_B,
        ]);
        await expect(page.getByText('Selected Files (2)')).toBeVisible();

        await page.getByRole('button', { name: 'Clear all' }).click();

        await expect(page.getByText(/Selected Files/)).toBeHidden();
    }
);

// A 50-file selection used to render 50 heavy rows into the page flow (#390):
// kilometric scroll, and every progress tick reconciled all of them. The list
// is now contained and virtualized — the page and the DOM stay bounded no
// matter how many files are queued.
test(
    'a 50-file selection stays contained — bounded page scroll, virtualized rows',
    {
        tag: [
            '@page:/dashboard/upload',
            '@uc:upload-large-selection-contained',
        ],
    },
    async ({ page, consoleErrors }) => {
        // One real image among the text files, so the tile's decode → resize →
        // cache pipeline runs in this tier and not only in a manual check.
        const image = makePngFile('queue-large-photo.png');
        const files = [image, ...makeTextFiles(49, 'queue-large')];

        await page.goto(UPLOAD_PAGE_URL);
        await page.setInputFiles('[data-testid="file-input"]', files);

        await expect(page.getByText('Selected Files (50)')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Upload 50 files' })
        ).toBeVisible();

        // The image row's tile resolves to a generated thumbnail (a blob URL,
        // never the raw file).
        await expect(
            page
                .getByTestId('upload-queue-row')
                .filter({ hasText: image.name })
                .locator('img')
        ).toBeVisible();

        // The queue scrolls inside its own container, not the page…
        const queue = page.getByTestId('upload-queue');
        await expect(queue).toBeVisible();
        expect(
            await queue.evaluate((el) => el.scrollHeight > el.clientHeight)
        ).toBe(true);
        // …so the page stays within a few screens, where rendering every row
        // into the page flow grew it by a row-height per file.
        const viewportHeight = page.viewportSize()!.height;
        expect(
            await page.evaluate(() => document.documentElement.scrollHeight)
        ).toBeLessThan(viewportHeight * 3);

        // Virtualized: the DOM holds the visible window plus overscan, never
        // every row — DOM size scaling with the selection is what melted the
        // page.
        const renderedRows = await page.getByTestId('upload-queue-row').count();
        expect(renderedRows).toBeGreaterThan(0);
        expect(renderedRows).toBeLessThan(files.length);

        // Rows past the window really exist: scrolling the container to the
        // bottom materializes the last file.
        await queue.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        await expect(fileName(page, 'queue-large-48.txt')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);
