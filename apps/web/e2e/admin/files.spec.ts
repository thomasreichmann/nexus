import { findUserByEmail, type File } from '@nexus/db/test-db';
import { test, expect } from '../fixtures';
import { ADMIN_USER } from '../helpers/auth';
import { seedFiles, cleanupFiles } from '../helpers/scenarios';
import {
    confirmSingleDelete,
    fileItem,
    openBatch,
} from '../helpers/fileBrowser';

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
            // The seeded files have no batch: they open as Ungrouped.
            await openBatch(page, 'Ungrouped');

            for (const file of seededFiles) {
                await expect(fileItem(page, file.name)).toBeVisible();
            }

            // Delete first file. 30s: on a cold dev server this is the first
            // mutation (route compile can exceed 10s).
            await confirmSingleDelete(page, seededFiles[0].name);
            await expect(fileItem(page, seededFiles[0].name)).toBeHidden({
                timeout: 30_000,
            });

            // Delete second file — this is the step that fails without the
            // fix. The server is warm by now (route compiled by the first
            // delete), so the timeout stays tight to keep guarding the
            // no-refresh sequential-delete regression.
            await confirmSingleDelete(page, seededFiles[1].name);
            await expect(fileItem(page, seededFiles[1].name)).toBeHidden({
                timeout: 10_000,
            });

            // Third file should still be visible
            await expect(fileItem(page, seededFiles[2].name)).toBeVisible();

            // Remove deleted files from cleanup list (already gone from DB)
            seededFiles = seededFiles.slice(2);
        }
    );
});
