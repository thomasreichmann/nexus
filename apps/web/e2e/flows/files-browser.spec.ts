/**
 * File browser interactions, run as a dedicated user (via the
 * `dedicatedUserConfig` fixture) so empty-state and exact-count assertions
 * can't race specs that share the regular/admin users.
 *
 * The library opens on batch cards (#455): every test opens the batch it
 * needs. The seeded library is a worker-scoped fixture (`seededLibrary`): it
 * seeds the batch + files + ready retrieval once and the serial tests share
 * it. The empty-vault test doesn't request it, so under serial mode it runs
 * first against the freshly-provisioned (empty) user; the deletes run last
 * and tear the batch down.
 *
 * Server mutations that hit S3 Glacier (`restore`) are intercepted and observed
 * rather than executed — seeded s3 keys have no real objects, and a real
 * Glacier restore takes hours. Those interceptions still verify the complete UI
 * wiring: menu/button → correct tRPC mutation + payload. Deletion runs for real
 * (a soft delete, with no S3 call at all).
 */
import {
    type UploadBatch,
    type File,
    insertUploadBatch,
    insertFile,
    insertRetrieval,
    deleteUserData,
} from '@nexus/db/test-db';
import {
    LIFECYCLE_TRANSITION_LAG_HOURS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '@nexus/db/objectState';
import { daysAgo } from '@nexus/db/seed';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { interceptTrpcCalls } from '../helpers/trpc';
import { fileName } from '../helpers/table';
import {
    backToLibrary,
    batchCard,
    confirmBatchDelete,
    confirmBulkDelete,
    expectBatchOpen,
    fileItem,
    openBatch,
    openRowMenu,
    toggleFile,
} from '../helpers/fileBrowser';

const FILES_USER: TestUser = {
    email: 'files-browser-e2e@test.local',
    password: 'files-browser-e2e-password-123',
    name: 'Files Browser E2E',
};
const STATE_PATH = 'e2e/.auth/files-browser.json';
const PAGE_URL = '/dashboard/files';
const UNGROUPED = 'Ungrouped';

interface SeededLibrary {
    batch: UploadBatch;
    archivedA: File;
    archivedB: File;
    archivedC: File;
    readyDoc: File;
    standardDoc: File;
}

const test = base.extend<
    NonNullable<unknown>,
    { seededLibrary: SeededLibrary }
>({
    seededLibrary: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            const batch = await insertUploadBatch(db, {
                userId,
                name: `Browser Batch ${Date.now()}`,
            });
            // Three archived files in the batch, listed in natural name
            // order (#404): arch-photo-aaa, arch-scan-ccc, arch-video-bbb.
            // The shift-click range test runs from the first to the last, so
            // the middle one only joins through the range.
            //
            // "Archived" is no longer a column (#416): it is derived from the
            // lifecycle policy, so these have to be genuinely past the window
            // and over the 128KB floor to read as cold. The two ungrouped
            // files stay warm on size alone, whatever their age.
            // Derived from the thresholds themselves so the fixture can't
            // drift from the policy it is standing in for.
            const COLD_SIZE = LIFECYCLE_TRANSITION_MIN_BYTES * 10;
            const COLD_DAYS = (LIFECYCLE_TRANSITION_LAG_HOURS / 24) * 4;
            const cold = (name: string, days: number) =>
                insertFile(db, {
                    userId,
                    batchId: batch.id,
                    name,
                    size: COLD_SIZE,
                    status: 'available',
                    createdAt: daysAgo(days),
                    updatedAt: daysAgo(days),
                });
            const archivedB = await cold('arch-video-bbb.mp4', COLD_DAYS + 1);
            const archivedA = await cold('arch-photo-aaa.jpg', COLD_DAYS);
            const archivedC = await cold('arch-scan-ccc.tif', COLD_DAYS + 2);
            // One ungrouped warm file with a ready retrieval (#257 fast path):
            // renders "available" with a download window, exactly like a
            // restored Deep Archive copy would (#259).
            const readyDoc = await insertFile(db, {
                userId,
                name: 'ready-doc-ccc.pdf',
                size: 3000,
                status: 'available',
                createdAt: new Date(Date.now() - 100),
                updatedAt: new Date(Date.now() - 100),
            });
            await insertRetrieval(db, {
                userId,
                fileId: readyDoc.id,
                status: 'ready',
            });
            // One ungrouped warm file with no retrieval: archived with
            // Retrieve only (#256), and the all-warm estimate case. Under the
            // 128KB floor, so it stays warm despite being the oldest row.
            const standardDoc = await insertFile(db, {
                userId,
                name: 'plain-doc-ddd.txt',
                size: 500,
                status: 'available',
                createdAt: daysAgo(COLD_DAYS + 2),
                updatedAt: daysAgo(COLD_DAYS + 2),
            });

            await use({
                batch,
                archivedA,
                archivedB,
                archivedC,
                readyDoc,
                standardDoc,
            });

            // Tear the library down before the dedicated user is deleted.
            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'serial' });
test.use({ dedicatedUserConfig: { user: FILES_USER, statePath: STATE_PATH } });

test(
    'empty vault shows the empty state with an upload CTA',
    { tag: ['@page:/dashboard/files', '@uc:files-empty-state'] },
    async ({ page, consoleErrors }) => {
        await page.goto(PAGE_URL);

        await expect(page.getByText('Your vault is empty')).toBeVisible();
        // Base UI's non-native Button renders the CTA anchor with
        // role="button".
        await expect(
            page.getByRole('button', { name: 'Upload files' })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    }
);

test.describe('with a seeded library', () => {
    test(
        'stats bar shows library-wide status counts',
        { tag: ['@uc:files-stats-bar'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await expect(
                batchCard(page, seededLibrary.batch.name)
            ).toBeVisible();

            await expect(page.getByText('5 files in 2 batches')).toBeVisible();
            // The ready-retrieval file counts as ready (#259); files without
            // one count as archived regardless of tier (#256).
            await expect(page.getByText('4 archived')).toBeVisible();
            // Visible: the Ungrouped card's phone-sized pill says "1 ready"
            // too, hidden at this width.
            await expect(
                page
                    .getByText('1 ready', { exact: true })
                    .filter({ visible: true })
            ).toBeVisible();
        }
    );

    test(
        'deep-link ?file={id} opens the batch on the target file',
        { tag: ['@uc:files-deep-link-focus'] },
        async ({ page, seededLibrary }) => {
            // The retrieval-ready email lands here: the file's batch opens,
            // and the file with it.
            await page.goto(`${PAGE_URL}?file=${seededLibrary.archivedB.id}`);

            const viewer = page.getByRole('dialog', {
                name: seededLibrary.archivedB.name,
            });
            await expect(viewer).toBeVisible();
            // In the header and the details panel alike.
            await expect(viewer.getByText('3 of 3').first()).toBeVisible();

            // Closing leaves the batch open behind it, the file in view.
            await page.keyboard.press('Escape');
            await expect(viewer).toBeHidden();
            await expectBatchOpen(page, seededLibrary.batch.name);
            await expect(
                fileItem(page, seededLibrary.archivedB.name)
            ).toBeInViewport();
            await expect(page).toHaveURL(
                new RegExp(`batch=${seededLibrary.batch.id}`)
            );
        }
    );

    test(
        'search matches batch and file names, and shows the no-match state',
        { tag: ['@uc:files-search'] },
        async ({ page, seededLibrary }) => {
            const shootCard = batchCard(page, seededLibrary.batch.name);
            const ungroupedCard = batchCard(page, UNGROUPED);
            await page.goto(PAGE_URL);
            await expect(shootCard).toBeVisible();

            // A file-name match: its batch shows, with how many files match,
            // and opens on only those.
            const search = page.getByPlaceholder('Search files and batches');
            await search.fill('aaa');
            await expect(ungroupedCard).toBeHidden();
            await expect(
                shootCard.getByText(/1 of 3 files match/)
            ).toBeVisible();
            await openBatch(page, seededLibrary.batch.name);
            await expect(
                fileItem(page, seededLibrary.archivedA.name)
            ).toBeVisible();
            await expect(
                fileItem(page, seededLibrary.archivedB.name)
            ).toBeHidden();
            await expect(page.getByText('1 matching file')).toBeVisible();
            await backToLibrary(page);

            // A batch-name match shows the batch whole.
            await search.fill('Browser Batch');
            await expect(ungroupedCard).toBeHidden();
            await expect(shootCard.getByText(/^3 files ·/)).toBeVisible();

            await search.fill('zzz-no-such-file');
            await expect(
                page.getByText(/No batches or files match/)
            ).toBeVisible();

            await search.clear();
            await expect(ungroupedCard).toBeVisible();
            await expect(shootCard).toBeVisible();
        }
    );

    test(
        'view toggles between grid and list',
        { tag: ['@uc:files-view-toggle'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            const list = page.getByRole('button', { name: 'List view' });
            const grid = page.getByRole('button', { name: 'Grid view' });
            // Grid by default: a tile, so no status label on the file.
            await expect(grid).toHaveAttribute('aria-pressed', 'true');
            const item = fileItem(page, seededLibrary.archivedA.name);
            await expect(item.getByText('Archived')).toHaveCount(0);

            await list.click();
            await expect(list).toHaveAttribute('aria-pressed', 'true');
            await expect(item.getByText('Archived')).toBeVisible();

            await grid.click();
            await expect(item.getByText('Archived')).toHaveCount(0);
        }
    );

    test(
        'select-all selects the whole batch and restores it by batch id',
        { tag: ['@uc:files-select-all'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBatchRetrieval'
            );
            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            await page.getByRole('checkbox', { name: 'Select all 3' }).click();
            await expect(page.getByText('All 3 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Retrieve' }).click();
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 3 files?')).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            // The batch, by id: not the file ids the browser loaded.
            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain(seededLibrary.batch.id);
            expect(calls[0]).not.toContain('fileIds');
        }
    );

    test(
        'multi-select via checkboxes and a shift-click range',
        { tag: ['@uc:files-multi-select'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            // First file, then a shift-click on the last: the middle one
            // (arch-scan-ccc) joins only through the range.
            await toggleFile(page, seededLibrary.archivedA.name);
            await expect(page.getByText('1 selected')).toBeVisible();

            await toggleFile(page, seededLibrary.archivedB.name, {
                modifiers: ['Shift'],
            });
            await expect(page.getByText('3 selected')).toBeVisible();

            await page.getByRole('button', { name: 'Clear selection' }).click();
            await expect(page.getByText('3 selected')).toBeHidden();
        }
    );

    test(
        'bulk retrieve confirms through the estimate dialog',
        {
            tag: [
                '@uc:files-bulk-retrieve',
                '@uc:files-retrieve-dialog-estimate',
            ],
        },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBulkRetrieval'
            );

            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            // Archived files selected → Retrieve opens the estimate dialog.
            await toggleFile(page, seededLibrary.archivedA.name);
            await toggleFile(page, seededLibrary.archivedB.name);
            await page.getByRole('button', { name: 'Retrieve' }).click();

            // Both selected files read as cold → slow estimate.
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 2 files?')).toBeVisible();
            await expect(
                dialog.getByText('Ready in up to 48 hours')
            ).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            // The files picked, by id, and not the one left out.
            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain('fileIds');
            expect(calls[0]).toContain(seededLibrary.archivedA.id);
            expect(calls[0]).toContain(seededLibrary.archivedB.id);
            expect(calls[0]).not.toContain(seededLibrary.archivedC.id);
        }
    );

    test(
        'single file retrieval confirms through the estimate dialog',
        { tag: ['@uc:files-request-retrieval-single'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestRetrieval'
            );

            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            await openRowMenu(page, seededLibrary.archivedB.name);
            await page
                .getByRole('menuitem', { name: 'Request retrieval' })
                .click();

            // A single cold-looking file → slow estimate.
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 1 file?')).toBeVisible();
            await expect(
                dialog.getByText('Ready in up to 48 hours')
            ).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain(seededLibrary.archivedB.id);
        }
    );

    test(
        'batch restore confirms through the estimate dialog',
        { tag: ['@uc:files-batch-restore'] },
        async ({ page, seededLibrary }) => {
            const calls = await interceptTrpcCalls(
                page,
                'files.requestBatchRetrieval'
            );

            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);
            await page.getByRole('button', { name: /Restore batch/i }).click();

            // The estimate comes from the server's count of cold files.
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 3 files?')).toBeVisible();
            await expect(
                dialog.getByText('Ready in up to 48 hours')
            ).toBeVisible();
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            await expect.poll(() => calls.length).toBe(1);
            expect(calls[0]).toContain(seededLibrary.batch.id);
        }
    );

    test(
        'ready standard-tier file renders available with a download window',
        { tag: ['@uc:files-ready-download-window'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await openBatch(page, UNGROUPED);
            await page.getByRole('button', { name: 'List view' }).click();

            // The synthetic 7-day window (#257) renders exactly like a real
            // restore's: "Ready to download" on the row, the expiry in the
            // viewer.
            const item = fileItem(page, seededLibrary.readyDoc.name);
            await expect(item.getByText('Ready to download')).toBeVisible();
            await item
                .getByRole('button', { name: seededLibrary.readyDoc.name })
                .click();
            const viewer = page.getByRole('dialog', {
                name: seededLibrary.readyDoc.name,
            });
            await expect(viewer.getByText(/^Until /)).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(viewer).toBeHidden();

            // Already downloadable → doesn't count toward bulk Retrieve.
            await toggleFile(page, seededLibrary.readyDoc.name);
            await expect(
                page.getByRole('button', { name: 'Retrieve' })
            ).toBeDisabled();
            await page.getByRole('button', { name: 'Clear selection' }).click();

            // Actions menu offers Download, not Request retrieval.
            await openRowMenu(page, seededLibrary.readyDoc.name);
            await expect(
                page.getByRole('menuitem', { name: 'Download' })
            ).toBeVisible();
            await expect(
                page.getByRole('menuitem', { name: 'Request retrieval' })
            ).toHaveCount(0);
            await page.keyboard.press('Escape');
        }
    );

    test(
        'standard-tier file without a retrieval renders archived and estimates ~minutes',
        {
            tag: [
                '@uc:files-standard-tier-archived',
                '@uc:files-retrieve-dialog-estimate',
            ],
        },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await openBatch(page, UNGROUPED);
            await page.getByRole('button', { name: 'List view' }).click();

            // No retrieval yet → archived with Retrieve only, no Download,
            // same as the colder tiers (#256).
            const item = fileItem(page, seededLibrary.standardDoc.name);
            await expect(item.getByText('Archived')).toBeVisible();
            await openRowMenu(page, seededLibrary.standardDoc.name);
            await expect(
                page.getByRole('menuitem', { name: 'Request retrieval' })
            ).toBeVisible();
            await expect(
                page.getByRole('menuitem', { name: 'Download' })
            ).toHaveCount(0);
            await page.keyboard.press('Escape');

            // All-warm selection → fast estimate.
            await toggleFile(page, seededLibrary.standardDoc.name);
            await page.getByRole('button', { name: 'Retrieve' }).click();
            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Ready in ~minutes')).toBeVisible();
            await dialog.getByRole('button', { name: 'Cancel' }).click();
        }
    );

    test(
        'bulk delete removes the selected files after confirmation',
        { tag: ['@uc:files-bulk-delete'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            await toggleFile(page, seededLibrary.archivedA.name);
            await toggleFile(page, seededLibrary.archivedB.name);
            await confirmBulkDelete(page, 2);

            await expect(
                fileItem(page, seededLibrary.archivedA.name)
            ).toBeHidden({ timeout: 10_000 });
            await expect(
                fileItem(page, seededLibrary.archivedB.name)
            ).toBeHidden();
            await expect(
                fileItem(page, seededLibrary.archivedC.name)
            ).toBeVisible();
        }
    );

    test(
        'deleting a batch from its menu removes all of it, after confirming its file count',
        { tag: ['@uc:files-batch-delete'] },
        async ({ page, seededLibrary }) => {
            await page.goto(PAGE_URL);
            await openBatch(page, seededLibrary.batch.name);

            // One file left after the bulk delete above.
            await confirmBatchDelete(page, 1);

            // Back to the library, where only the legacy files are left.
            await expect(batchCard(page, seededLibrary.batch.name)).toBeHidden({
                timeout: 10_000,
            });
            await expect(batchCard(page, UNGROUPED)).toBeVisible();
            await expect(page.getByText('2 files in 1 batch')).toBeVisible();
            await expect(fileName(page, 'Browser Batch')).toBeHidden();
        }
    );
});
