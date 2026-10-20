/**
 * The file browser at library scale (#455): the library loads its batch cards
 * a page at a time, and an open batch its files 100 at a time, in natural
 * filename order, from the server. A deep link into the middle of a big batch
 * opens at the file's page and can page back to the start; select-all takes
 * the whole batch, loaded or not, and deletes it by batch id.
 *
 * A dedicated user of its own: the seed is hundreds of rows and the last test
 * deletes the big batch. Serial, as the tests share that seed and the delete
 * comes last.
 */
import {
    type File,
    type UploadBatch,
    insertFile,
    insertUploadBatch,
    deleteUserData,
} from '@nexus/db/test-db';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { waitForTrpcRequest } from '../helpers/trpc';
import {
    batchCard,
    confirmBulkDelete,
    expectBatchOpen,
    fileItem,
    fileItems,
    openBatch,
} from '../helpers/fileBrowser';

const PAGING_USER: TestUser = {
    email: 'files-paging-e2e@test.local',
    password: 'files-paging-e2e-password-123',
    name: 'Files Paging E2E',
};
const STATE_PATH = 'e2e/.auth/files-paging.json';
const PAGE_URL = '/dashboard/files';

// Past two pages of 100, and a third that's partly full.
const BIG_BATCH_FILES = 230;
// Past one page of 12 cards.
const OLDER_BATCHES = 13;
const HOUR_MS = 60 * 60 * 1000;
// For waits on more than one round trip. A deep link's viewer opens only once
// `files.locate`, `getBatch` and the file's page of `listBatchFiles` have
// answered, one after another, and a failed one retries after a second. Under
// a full local run against the shared dev DB, that chain alone can take more
// than 5 s (#546).
const LOAD_TIMEOUT = 15_000;

interface PagingLibrary {
    big: UploadBatch;
    oldest: UploadBatch;
    /** The big batch's files by name: IMG_1.JPG … IMG_230.JPG. */
    fileNamed: (name: string) => File;
}

const test = base.extend<NonNullable<unknown>, { library: PagingLibrary }>({
    library: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const now = Date.now();
            const big = await insertUploadBatch(db, {
                userId,
                name: 'Big Shoot',
                createdAt: new Date(now),
            });
            const older = await Promise.all(
                Array.from({ length: OLDER_BATCHES }, (_, i) =>
                    insertUploadBatch(db, {
                        userId,
                        name: `Older Shoot ${i + 1}`,
                        createdAt: new Date(now - (i + 1) * HOUR_MS),
                    })
                )
            );
            await Promise.all(
                older.map((batch) =>
                    insertFile(db, { userId, batchId: batch.id })
                )
            );
            // Unpadded numbers, so a plain text sort would list IMG_10 and
            // IMG_100 before IMG_2; uploaded in reverse, so upload order is
            // no help either.
            const files = await Promise.all(
                Array.from({ length: BIG_BATCH_FILES }, (_, i) =>
                    insertFile(db, {
                        userId,
                        batchId: big.id,
                        name: `IMG_${i + 1}.JPG`,
                        size: 1000,
                        createdAt: new Date(now - i * 1000),
                    })
                )
            );
            const byName = new Map(files.map((f) => [f.name, f]));

            await use({
                big,
                oldest: older.at(-1)!,
                fileNamed: (name) => byName.get(name)!,
            });

            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'serial' });
test.use({
    dedicatedUserConfig: { user: PAGING_USER, statePath: STATE_PATH },
});

test(
    'the library loads its batch cards a page at a time, newest first',
    { tag: ['@page:/dashboard/files', '@uc:files-library-paging'] },
    async ({ page, library }) => {
        test.slow();
        const card = (batch: UploadBatch) => batchCard(page, batch.name);

        await page.goto(PAGE_URL);
        await expect(card(library.big)).toBeVisible();
        await expect(page.getByText('Showing 12 of 14 batches')).toBeVisible();
        await expect(card(library.oldest)).toHaveCount(0);

        await page.getByRole('button', { name: 'Show 2 more' }).click();
        await expect(card(library.oldest)).toBeVisible();
        await expect(page.getByText('Showing 14 of 14 batches')).toBeVisible();
    }
);

test(
    'an open batch loads its files 100 at a time, in natural filename order',
    { tag: ['@uc:files-batch-paging'] },
    async ({ page }) => {
        const tiles = fileItems(page);

        await page.goto(PAGE_URL);
        await openBatch(page, 'Big Shoot');
        await expect(tiles).toHaveCount(100);
        await expect(tiles.nth(1)).toContainText('IMG_2.JPG');
        await expect(tiles.nth(99)).toContainText('IMG_100.JPG');
        await expect(page.getByText('Showing 100 of 230')).toBeVisible();

        await page.getByRole('button', { name: 'Show next 100' }).click();
        await expect(tiles).toHaveCount(200);
        await page.getByRole('button', { name: 'Show next 30' }).click();
        await expect(tiles).toHaveCount(230);
        await expect(tiles.last()).toContainText('IMG_230.JPG');
        await expect(page.getByText('All 230 files')).toBeVisible();
    }
);

test(
    'a deep link into a later page opens there, and pages back to the start',
    { tag: ['@uc:files-deep-link-focus', '@uc:files-batch-paging'] },
    async ({ page, library }) => {
        const target = library.fileNamed('IMG_150.JPG');

        await page.goto(`${PAGE_URL}?file=${target.id}`);
        const viewer = page.getByRole('dialog', { name: target.name });
        await expect(viewer).toBeVisible({ timeout: LOAD_TIMEOUT });
        await expect(viewer.getByText('150 of 230').first()).toBeVisible();

        // The batch behind it holds the file's page, 101-200, not the first.
        await page.keyboard.press('Escape');
        await expect(viewer).toBeHidden();
        await expectBatchOpen(page, 'Big Shoot');
        await expect(fileItem(page, target.name)).toBeInViewport();
        await expect(fileItem(page, 'IMG_1.JPG')).toHaveCount(0);

        await page.getByRole('button', { name: 'Show earlier files' }).click();
        await expect(fileItem(page, 'IMG_1.JPG')).toHaveCount(1);
        await expect(fileItems(page)).toHaveCount(200);
    }
);

test(
    'the viewer browses past the end of what’s loaded into the next page',
    { tag: ['@uc:files-batch-paging'] },
    async ({ page, library }) => {
        const last = library.fileNamed('IMG_200.JPG');

        await page.goto(`${PAGE_URL}?file=${last.id}`);
        // Arrows browse once the open has landed; Esc is the only key before.
        await expect(
            page.getByRole('dialog', { name: last.name })
        ).toHaveAttribute('data-viewer-phase', 'open', {
            timeout: LOAD_TIMEOUT,
        });

        // IMG_200 ends its page. One press is one step, whether the next
        // page is in yet or the step waits for it.
        await page.keyboard.press('ArrowRight');
        const next = page.getByRole('dialog', { name: 'IMG_201.JPG' });
        await expect(next.getByText('201 of 230').first()).toBeVisible();
        await expect(
            page.getByRole('dialog', { name: 'IMG_202.JPG' })
        ).toHaveCount(0);
    }
);

test(
    'select-all takes the whole batch, loaded or not, and deletes it by batch id',
    { tag: ['@uc:files-select-all', '@uc:files-batch-delete'] },
    async ({ page, library }) => {
        await page.goto(PAGE_URL);
        await openBatch(page, 'Big Shoot');
        await expect(fileItems(page)).toHaveCount(100);

        await page
            .getByRole('checkbox', { name: `Select all ${BIG_BATCH_FILES}` })
            .click();
        await expect(
            page.getByText(`All ${BIG_BATCH_FILES} selected`)
        ).toBeVisible();

        const deleted = waitForTrpcRequest(page, 'files.deleteBatch');
        await confirmBulkDelete(page, BIG_BATCH_FILES);
        expect((await deleted).postData()).toContain(library.big.id);

        await expect(batchCard(page, library.big.name)).toHaveCount(0, {
            timeout: LOAD_TIMEOUT,
        });
        await expect(page.getByText('13 files in 13 batches')).toBeVisible();
    }
);
