import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { findUserByEmail, type File } from '@nexus/db/test-db';
import { ADMIN_USER } from '../helpers/auth';
import { seedFiles, cleanupFiles } from '../helpers/scenarios';
import { fileName, waitForTableLoad } from '../helpers/table';

const PAGE_URL = '/dashboard/files';

test.use({ userRole: 'admin' });
test.describe.configure({ mode: 'serial' });

test.describe('sequential file deletion', () => {
    let seededFiles: File[] = [];

    test.beforeAll(async ({ db }) => {
        const user = await findUserByEmail(db, ADMIN_USER.email);
        if (!user) throw new Error('Admin user not found — run setup first');
        seededFiles = await seedFiles(db, user.id, 3);
    });

    test.afterAll(async ({ db }) => {
        await cleanupFiles(db, seededFiles);
    });

    test(
        'can delete multiple files sequentially without page refresh',
        { tag: ['@page:/dashboard/files', '@uc:files-delete-single'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);
            await waitForTableLoad(page, 'No files yet');

            // Verify all 3 seeded files are visible. fileName scopes to the
            // visible copy — each name renders several times (dual mobile/
            // desktop markup × MiddleTruncateName's two copies).
            for (const file of seededFiles) {
                await expect(fileName(page, file.name)).toBeVisible();
            }

            // Delete first file. 30s: on a cold dev server this is the first
            // S3-touching mutation (route compile + SDK init can exceed 10s).
            await deleteFileByName(page, seededFiles[0].name);
            await expect(fileName(page, seededFiles[0].name)).toBeHidden({
                timeout: 30_000,
            });

            // Delete second file — this is the step that fails without the
            // fix. The server is warm by now (route compiled, SDK
            // initialized by the first delete), so the timeout stays tight
            // to keep guarding the no-refresh sequential-delete regression.
            await deleteFileByName(page, seededFiles[1].name);
            await expect(fileName(page, seededFiles[1].name)).toBeHidden({
                timeout: 10_000,
            });

            // Third file should still be visible
            await expect(fileName(page, seededFiles[2].name)).toBeVisible();

            // Remove deleted files from cleanup list (already gone from DB)
            seededFiles = seededFiles.slice(2);
        }
    );
});

async function deleteFileByName(page: Page, name: string): Promise<void> {
    // Find the row containing the file name and click its actions menu
    const row = page.locator('tr', { hasText: name });
    await row.getByRole('button', { name: 'Actions' }).click();

    // Click the Delete item in the dropdown
    await page.getByRole('menuitem', { name: 'Delete' }).click();
}
