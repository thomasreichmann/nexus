/**
 * Manual validation: upload batches (#217 / PR #224) + storage quota (PR #225).
 *
 * Run with:  pnpm -F web test:e2e:validate
 *
 * What it mutates (destructive — dev DB + dev S3 bucket):
 *  - DELETEs all files and upload_batches rows for REGULAR_USER
 *  - Resets / parks the user's storage_usage row (back to 0 at end)
 *  - Leaves a small test object in the S3 dev bucket per run
 *
 * What it covers:
 *  - Fresh upload through the UI → new s3Key shape
 *    (`${userId}/${batchId}/${fileId}/${name}`), `upload_batches` row created
 *    with fallback name `Upload YYYY-MM-DD HH:MM`, `files.batch_id` set,
 *    `storage_usage` incremented by the file's bytes.
 *  - Dashboard "Storage Usage" widget renders after the upload.
 *  - Multi-file upload in one click (#268): both files land in a single
 *    `upload_batches` row and share the `${userId}/${batchId}/` key prefix.
 *  - Quota soft cap: with `storage_usage` parked at 105%, attempting an
 *    upload through the UI surfaces an error and creates no DB row.
 *
 * Not covered (intentional): old-format s3Key downloads. Every s3Key consumer
 * (`retrieval.ts`, `files.ts` multipart, `s3-restore.ts`) treats the value as
 * opaque, so legacy keys can't regress through code changes here.
 */
import { test, expect } from '../fixtures';
import type { Connection } from '@nexus/db/test-db';
import {
    findUserByEmail,
    deleteUserData,
    insertStorageUsage,
} from '@nexus/db/test-db';
import { REGULAR_USER } from '../helpers/auth';
import { fileName } from '../helpers/table';
import { PLAN_LIMITS } from '@nexus/db/plans';

// Single shared user → tests must run serially. Belt-and-braces: the
// `test:e2e:validate` script also passes `--workers=1`.
test.describe.configure({ mode: 'serial' });
test.use({ userRole: 'user' });

const SCREENSHOTS = 'test-results/validate/upload-batches-and-quota';

// Hooks see only worker fixtures (not the test-scoped seedUserId), so resolve
// the user from the connection directly.
async function getUserId(db: Connection): Promise<string> {
    const u = await findUserByEmail(db, REGULAR_USER.email);
    if (!u) throw new Error(`regular user missing: ${REGULAR_USER.email}`);
    return u.id;
}

async function resetUserState(db: Connection, userId: string): Promise<void> {
    await deleteUserData(db, userId);
    await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
}

test.describe('upload batches + storage quota', () => {
    test.beforeAll(async ({ db }) => {
        await resetUserState(db, await getUserId(db));
    });

    test.afterAll(async ({ db }) => {
        await resetUserState(db, await getUserId(db));
    });

    test(
        'fresh upload creates batch, new-format s3Key, increments storage_usage',
        { tag: ['@page:/dashboard/upload', '@uc:upload-single-file-flow'] },
        async ({ page, db, seedUserId: userId }) => {
            await page.goto('/dashboard/upload');
            await expect(
                page.getByRole('heading', { name: 'Upload Files', exact: true })
            ).toBeVisible();

            const fileBuf = Buffer.from('hello upload batches validate\n');
            const fileName = `validate-${Date.now()}.txt`;

            await page.setInputFiles('input[type="file"]', {
                name: fileName,
                mimeType: 'text/plain',
                buffer: fileBuf,
            });
            await page.screenshot({
                path: `${SCREENSHOTS}/01-after-select.png`,
                fullPage: true,
            });

            await page
                .getByRole('button', { name: /^Upload \d+ files?$/ })
                .click();
            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toBeVisible({
                timeout: 30_000,
            });
            await page.screenshot({
                path: `${SCREENSHOTS}/02-after-upload.png`,
                fullPage: true,
            });

            // ---- DB assertions ----
            const batches = await db.query.uploadBatches.findMany({
                where: (b, { eq }) => eq(b.userId, userId),
            });
            expect(batches).toHaveLength(1);
            const batch = batches[0];
            // Fallback name shape: `Upload YYYY-MM-DD HH:MM`.
            expect(batch.name).toMatch(
                /^Upload \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
            );

            const files = await db.query.files.findMany({
                where: (f, { eq, and }) =>
                    and(eq(f.userId, userId), eq(f.name, fileName)),
            });
            expect(files).toHaveLength(1);
            const file = files[0];
            expect(file.status).toBe('available');
            expect(file.batchId).toBe(batch.id);
            expect(file.s3Key).toBe(
                `${userId}/${batch.id}/${file.id}/${fileName}`
            );
            expect(file.size).toBe(fileBuf.byteLength);

            const usage = await db.query.storageUsage.findFirst({
                where: (u, { eq }) => eq(u.userId, userId),
            });
            expect(usage?.usedBytes).toBe(fileBuf.byteLength);
            expect(usage?.fileCount).toBe(1);
        }
    );

    test(
        'dashboard Storage Usage widget renders after upload',
        { tag: ['@page:/dashboard', '@uc:dashboard-storage-usage-widget'] },
        async ({ page }) => {
            await page.goto('/dashboard');
            await expect(
                page.getByRole('heading', { name: /welcome back, .+/i })
            ).toBeVisible();
            await expect(page.getByText('Storage Usage')).toBeVisible();
            await page.screenshot({
                path: `${SCREENSHOTS}/03-dashboard.png`,
                fullPage: true,
            });
        }
    );

    test(
        'grouped files page shows the auto-created batch from the upload',
        { tag: ['@page:/dashboard/files', '@uc:upload-batch-grouping'] },
        async ({ page }) => {
            // Depends on the fresh-upload test having created the batch.
            await page.goto('/dashboard/files');
            await expect(
                page.getByRole('heading', { name: /files/i, exact: false })
            ).toBeVisible();

            // The auto-created batch uses the fallback name format
            // `Upload YYYY-MM-DD HH:MM`. Match heading by that pattern.
            await expect(
                page.getByRole('heading', { name: /^Upload \d{4}-\d{2}-\d{2}/ })
            ).toBeVisible();
            // The single uploaded file should be visible (default expanded).
            // visible+first: each name renders several times (dual mobile/
            // desktop markup × MiddleTruncateName's two copies).
            await expect(fileName(page, 'validate-')).toBeVisible();

            await page.screenshot({
                path: `${SCREENSHOTS}/05-grouped-files-page.png`,
                fullPage: true,
            });
        }
    );

    test(
        'multi-file upload in one click creates a single shared batch',
        {
            tag: [
                '@page:/dashboard/upload',
                '@uc:upload-multi-file-single-batch',
            ],
        },
        async ({ page, db, seedUserId: userId }) => {
            // Reset so "exactly one batch" is a strict assertion rather than a
            // delta over the single-file test's leftover batch. Runs before
            // the quota test, which re-parks usage itself.
            await resetUserState(db, userId);

            await page.goto('/dashboard/upload');
            await expect(
                page.getByRole('heading', { name: 'Upload Files', exact: true })
            ).toBeVisible();

            const stamp = Date.now();
            const filesToUpload = [
                {
                    name: `validate-multi-a-${stamp}.txt`,
                    mimeType: 'text/plain',
                    buffer: Buffer.from('multi-file batch validate: file a\n'),
                },
                {
                    name: `validate-multi-b-${stamp}.txt`,
                    mimeType: 'text/plain',
                    buffer: Buffer.from('multi-file batch validate: file b!\n'),
                },
            ];

            await page.setInputFiles('input[type="file"]', filesToUpload);
            await expect(page.getByText('Selected Files (2)')).toBeVisible();
            await page.screenshot({
                path: `${SCREENSHOTS}/06-multi-after-select.png`,
                fullPage: true,
            });

            await page
                .getByRole('button', { name: /^Upload \d+ files?$/ })
                .click();
            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toHaveCount(2, { timeout: 30_000 });
            await page.screenshot({
                path: `${SCREENSHOTS}/07-multi-after-upload.png`,
                fullPage: true,
            });

            // ---- DB assertions ----
            // One click → one batch (not one per file, the #268 regression).
            const batches = await db.query.uploadBatches.findMany({
                where: (b, { eq }) => eq(b.userId, userId),
            });
            expect(batches).toHaveLength(1);
            const batch = batches[0];
            expect(batch.name).toMatch(
                /^Upload \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
            );

            const names = filesToUpload.map((f) => f.name);
            const files = await db.query.files.findMany({
                where: (f, { eq, and, inArray }) =>
                    and(eq(f.userId, userId), inArray(f.name, names)),
            });
            expect(files).toHaveLength(2);
            for (const file of files) {
                expect(file.status).toBe('available');
                expect(file.batchId).toBe(batch.id);
                expect(file.s3Key).toBe(
                    `${userId}/${batch.id}/${file.id}/${file.name}`
                );
            }

            const totalBytes = filesToUpload.reduce(
                (sum, f) => sum + f.buffer.byteLength,
                0
            );
            const usage = await db.query.storageUsage.findFirst({
                where: (u, { eq }) => eq(u.userId, userId),
            });
            expect(usage?.usedBytes).toBe(totalBytes);
            expect(usage?.fileCount).toBe(2);
        }
    );

    test(
        'quota soft cap: UI surfaces upload error when over 105%',
        { tag: ['@page:/dashboard/upload', '@uc:upload-quota-exceeded'] },
        async ({ page, db, seedUserId: userId }) => {
            // Park usage at exactly 105% of starter — any positive sizeBytes
            // pushes past the soft cap.
            const at105 = Math.floor(PLAN_LIMITS.starter * 1.05);
            await insertStorageUsage(db, {
                userId,
                usedBytes: at105,
                fileCount: 1,
            });

            await page.goto('/dashboard/upload');
            await expect(
                page.getByRole('heading', { name: 'Upload Files', exact: true })
            ).toBeVisible();

            const rejectedName = `quota-rejected-${Date.now()}.txt`;
            await page.setInputFiles('input[type="file"]', {
                name: rejectedName,
                mimeType: 'text/plain',
                buffer: Buffer.from('over-quota attempt\n'),
            });
            await page
                .getByRole('button', { name: /^Upload \d+ files?$/ })
                .click();

            // UploadZone renders a Retry button + inline error on rejection.
            await expect(
                page.getByRole('button', { name: 'Retry upload' })
            ).toBeVisible({ timeout: 15_000 });
            await expect(
                page.getByText('Uploaded', { exact: true })
            ).toHaveCount(0);

            await page.screenshot({
                path: `${SCREENSHOTS}/04-quota-rejected.png`,
                fullPage: true,
            });

            // No file row with the rejected name should have been created.
            const rejected = await db.query.files.findMany({
                where: (f, { eq, and }) =>
                    and(eq(f.userId, userId), eq(f.name, rejectedName)),
            });
            expect(rejected).toHaveLength(0);
        }
    );
});
