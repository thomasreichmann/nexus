/**
 * Bulk delete past the old 100-file cap (#400).
 *
 * A batch now pages its files in 100 at a time (#455), but a selection of
 * loaded rows still grows past 100 once the next page is in, and `deleteMany`
 * used to reject anything over 100 — with a toast holding the raw Zod
 * payload. This spec is the regression guard for the raised cap, so it
 * deliberately seeds past 100, pages them all in and selects them by id with
 * a shift-click range across both pages.
 *
 * Its own dedicated user (not `files-browser.spec.ts`'s) so the 120-row seed
 * can't perturb that file's exact-count assertions or its serial ordering.
 * Deletion runs for real, and needs no objects behind the seeded keys: it is a
 * soft-delete transaction with no S3 fan-out at all.
 */
import { expect } from '../fixtures';
import { withSeededFiles } from '../fixtures/seeded-files';
import { type TestUser } from '../helpers/auth';
import { waitForTrpcRequest } from '../helpers/trpc';
import {
    confirmBulkDelete,
    fileItem,
    openBatch,
    toggleFile,
} from '../helpers/fileBrowser';

const BULK_DELETE_USER: TestUser = {
    email: 'files-bulk-delete-e2e@test.local',
    password: 'files-bulk-delete-e2e-password-123',
    name: 'Files Bulk Delete E2E',
};
const STATE_PATH = 'e2e/.auth/files-bulk-delete.json';
const PAGE_URL = '/dashboard/files';

// Clear of the old cap by enough that an off-by-one in some future cap can't
// slip through, and small enough that seeding plus a 120-row render stays
// inside the (slow-marked) test timeout.
const FILE_COUNT = 120;

const test = withSeededFiles(FILE_COUNT);

test.use({
    dedicatedUserConfig: { user: BULK_DELETE_USER, statePath: STATE_PATH },
});

test(
    'bulk delete removes a selection larger than the old 100-file cap',
    { tag: ['@uc:files-bulk-delete-at-scale'] },
    async ({ page, seededFiles }) => {
        test.slow();
        // Named e2e-test-file-1 … -120: natural order lists them by number.
        const first = seededFiles.find(
            (f) => f.name === 'e2e-test-file-1.txt'
        )!;
        const last = seededFiles.find(
            (f) => f.name === `e2e-test-file-${FILE_COUNT}.txt`
        )!;
        await page.goto(PAGE_URL);
        await openBatch(page, 'Ungrouped');
        await expect(
            page.getByText(`Showing 100 of ${FILE_COUNT}`)
        ).toBeVisible();
        await page.getByRole('button', { name: 'Show next 20' }).click();
        await expect(fileItem(page, last.name)).toBeVisible();

        await toggleFile(page, first.name);
        await toggleFile(page, last.name, { modifiers: ['Shift'] });
        await expect(page.getByText(`${FILE_COUNT} selected`)).toBeVisible();

        const deleted = waitForTrpcRequest(page, 'files.deleteMany');
        await confirmBulkDelete(page, FILE_COUNT);

        // By id, every one of them: this is the path that hit the cap.
        const body = (await deleted).postData() ?? '';
        expect(body).toContain(first.id);
        expect(body).toContain(last.id);
        // An empty vault is the proof the whole selection committed. Under the
        // old cap the mutation was rejected outright, so the rows would still
        // be here when this times out.
        await expect(page.getByText('Your vault is empty')).toBeVisible({
            timeout: 20_000,
        });
    }
);
