/**
 * Bulk delete past the old 100-file cap (#400).
 *
 * `listGrouped` is unpaginated and select-all takes everything visible, so a
 * real archive reaches a selection far bigger than the 100 `deleteMany` used to
 * accept — and the rejection surfaced as a toast holding the raw Zod payload.
 * This spec is the regression guard for the raised cap, so it deliberately
 * seeds past 100 rather than asserting the number in the schema.
 *
 * Its own dedicated user (not `files-browser.spec.ts`'s) so the 120-row seed
 * can't perturb that file's exact-count assertions or its serial ordering.
 * Deletion runs for real, and needs no objects behind the seeded keys: it is a
 * soft-delete transaction with no S3 fan-out at all.
 */
import { deleteUserData, type File } from '@nexus/db/test-db';
import { test as base, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { seedFiles } from '../helpers/scenarios';
import { confirmBulkDelete } from '../helpers/fileBrowser';
import { fileName } from '../helpers/table';

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

const test = base.extend<NonNullable<unknown>, { seededFiles: File[] }>({
    seededFiles: [
        async ({ db, dedicatedUser }, use) => {
            const userId = dedicatedUser!.userId;
            // Ungrouped (no batchId) so they render in one flat, expanded
            // group — the shape select-all walks.
            const files = await seedFiles(db, userId, FILE_COUNT);

            await use(files);

            // Tear the library down before the dedicated user is deleted.
            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.use({
    dedicatedUserConfig: { user: BULK_DELETE_USER, statePath: STATE_PATH },
});

test(
    'bulk delete removes a selection larger than the old 100-file cap',
    { tag: ['@uc:files-bulk-delete-at-scale'] },
    async ({ page, seededFiles }) => {
        test.slow();

        await page.goto(PAGE_URL);
        await expect(fileName(page, seededFiles[0]!.name)).toBeVisible();

        await page.getByRole('checkbox', { name: 'Select all' }).click();
        await expect(page.getByText(`${FILE_COUNT} selected`)).toBeVisible();

        await confirmBulkDelete(page, FILE_COUNT);

        // An empty vault is the proof the whole selection committed. Under the
        // old cap the mutation was rejected outright, so the rows would still
        // be here when this times out.
        await expect(page.getByText('Your vault is empty')).toBeVisible({
            timeout: 20_000,
        });
    }
);
