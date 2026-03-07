import { test, expect, type Page } from '@playwright/test';
import { findUserByEmail } from '../helpers/db';
import { seedFiles, cleanupFiles, type DbFile } from '../helpers/seed';
import { ADMIN_USER } from '../helpers/auth';

const PAGE_URL = '/dashboard/files';

test.describe.configure({ mode: 'serial' });

test.describe('sequential file deletion', () => {
    let seededFiles: DbFile[] = [];

    test.beforeAll(async () => {
        const user = await findUserByEmail(ADMIN_USER.email);
        if (!user) throw new Error('Admin user not found — run setup first');
        seededFiles = await seedFiles(user.id, 3);
    });

    test.afterAll(async () => {
        await cleanupFiles(seededFiles);
    });

    test('can delete multiple files sequentially without page refresh', async ({
        page,
    }) => {
        await page.goto(PAGE_URL);
        await waitForFileList(page);

        // Verify all 3 seeded files are visible
        for (const file of seededFiles) {
            await expect(page.getByText(file.name)).toBeVisible();
        }

        // Delete first file
        await deleteFileByName(page, seededFiles[0].name);
        await expect(page.getByText(seededFiles[0].name)).toBeHidden({
            timeout: 10_000,
        });

        // Delete second file — this is the step that fails without the fix
        await deleteFileByName(page, seededFiles[1].name);
        await expect(page.getByText(seededFiles[1].name)).toBeHidden({
            timeout: 10_000,
        });

        // Third file should still be visible
        await expect(page.getByText(seededFiles[2].name)).toBeVisible();

        // Remove deleted files from cleanup list (already gone from DB)
        seededFiles = seededFiles.slice(2);
    });
});

async function waitForFileList(page: Page): Promise<void> {
    await page
        .locator('table')
        .or(page.getByText('No files yet'))
        .first()
        .waitFor({ timeout: 10_000 });
}

async function deleteFileByName(page: Page, name: string): Promise<void> {
    // Find the row containing the file name and click its actions menu
    const row = page.locator('tr', { hasText: name });
    await row.getByRole('button', { name: 'Actions' }).click();

    // Click the Delete item in the dropdown
    await page.getByRole('menuitem', { name: 'Delete' }).click();
}
