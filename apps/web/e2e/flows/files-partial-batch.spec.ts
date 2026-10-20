/**
 * A batch whose Upload click sent more files than ever landed says so in the
 * library (#550), on its card and once opened, and a whole one says nothing.
 * Its own dedicated user, so the seeded batches can't touch another spec's
 * counts.
 */
import {
    deleteUserData,
    insertFile,
    insertUploadBatch,
} from '@nexus/db/test-db';
import { test, expect } from '../fixtures';
import { type TestUser } from '../helpers/auth';
import { batchCard, openBatch } from '../helpers/fileBrowser';

const PARTIAL_USER: TestUser = {
    email: 'files-partial-e2e@test.local',
    password: 'files-partial-e2e-password-123',
    name: 'Files Partial E2E',
};

test.use({
    dedicatedUserConfig: {
        user: PARTIAL_USER,
        statePath: 'e2e/.auth/files-partial.json',
    },
});

test(
    'a batch that came up short says how many files never finished',
    { tag: ['@page:/dashboard/files', '@uc:files-partial-batch'] },
    async ({ page, db, seedUserId }) => {
        // Past the hour a batch has to be quiet before it's judged.
        const at = new Date(Date.now() - 2 * 3_600_000);
        try {
            const [short, whole] = await Promise.all([
                insertUploadBatch(db, {
                    userId: seedUserId,
                    name: 'Short Shoot',
                    expectedFileCount: 3,
                    createdAt: at,
                }),
                insertUploadBatch(db, {
                    userId: seedUserId,
                    name: 'Whole Shoot',
                    expectedFileCount: 1,
                    createdAt: at,
                }),
            ]);
            await Promise.all(
                [short, whole].map((batch) =>
                    insertFile(db, {
                        userId: seedUserId,
                        batchId: batch.id,
                        createdAt: at,
                        confirmedAt: at,
                    })
                )
            );

            await page.goto('/dashboard/files');

            await expect(batchCard(page, 'Short Shoot')).toContainText(
                '2 missing'
            );
            await expect(batchCard(page, 'Whole Shoot')).toBeVisible();
            await expect(batchCard(page, 'Whole Shoot')).not.toContainText(
                'missing'
            );

            await openBatch(page, 'Short Shoot');
            await expect(
                page.getByText(/2 of 3 files didn't finish uploading/)
            ).toBeVisible();
        } finally {
            await deleteUserData(db, seedUserId);
        }
    }
);
