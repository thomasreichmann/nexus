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
 *  - Quota soft cap: with `storage_usage` parked at 105%, attempting an
 *    upload through the UI surfaces an error and creates no DB row.
 *
 * Not covered (intentional): old-format s3Key downloads. Every s3Key consumer
 * (`retrieval.ts`, `files.ts` multipart, `s3-restore.ts`) treats the value as
 * opaque, so legacy keys can't regress through code changes here.
 */
import { test, expect } from '../fixtures/authenticated';
import { findUserByEmail, getDb } from '../helpers/db';
import { REGULAR_USER } from '../helpers/auth';
import { PLAN_LIMITS } from '@nexus/db/plans';

// Single shared user → tests must run serially. Belt-and-braces: the
// `test:e2e:validate` script also passes `--workers=1`.
test.describe.configure({ mode: 'serial' });
test.use({ userRole: 'user' });

const SCREENSHOTS = 'test-results/validate/upload-batches-and-quota';

async function getUserId(): Promise<string> {
    const u = await findUserByEmail(REGULAR_USER.email);
    if (!u) throw new Error(`regular user missing: ${REGULAR_USER.email}`);
    return u.id;
}

async function resetUserState(userId: string): Promise<void> {
    const sql = getDb();
    await sql`DELETE FROM files WHERE user_id = ${userId}`;
    await sql`DELETE FROM upload_batches WHERE user_id = ${userId}`;
    await sql`
        INSERT INTO storage_usage (id, user_id, used_bytes, file_count)
        VALUES (gen_random_uuid()::text, ${userId}, 0, 0)
        ON CONFLICT (user_id) DO UPDATE SET
            used_bytes = 0,
            file_count = 0,
            updated_at = now()
    `;
}

test.describe('upload batches + storage quota', () => {
    test.beforeAll(async () => {
        await resetUserState(await getUserId());
    });

    test.afterAll(async () => {
        await resetUserState(await getUserId());
        await getDb().end({ timeout: 5 });
    });

    test('fresh upload creates batch, new-format s3Key, increments storage_usage', async ({
        page,
    }) => {
        const userId = await getUserId();
        const sql = getDb();

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

        await page.getByRole('button', { name: /^Upload \d+ files?$/ }).click();
        await expect(page.getByText('Uploaded', { exact: true })).toBeVisible({
            timeout: 30_000,
        });
        await page.screenshot({
            path: `${SCREENSHOTS}/02-after-upload.png`,
            fullPage: true,
        });

        // ---- DB assertions ----
        const batches = await sql<{ id: string; name: string }[]>`
            SELECT id, name FROM upload_batches WHERE user_id = ${userId}
        `;
        expect(batches).toHaveLength(1);
        const batch = batches[0];
        // Fallback name shape: `Upload YYYY-MM-DD HH:MM`.
        expect(batch.name).toMatch(/^Upload \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

        const files = await sql<
            {
                id: string;
                size: number;
                s3_key: string;
                status: string;
                batch_id: string | null;
            }[]
        >`
            SELECT id, size, s3_key, status, batch_id
            FROM files
            WHERE user_id = ${userId} AND name = ${fileName}
        `;
        expect(files).toHaveLength(1);
        const file = files[0];
        expect(file.status).toBe('available');
        expect(file.batch_id).toBe(batch.id);
        expect(file.s3_key).toBe(
            `${userId}/${batch.id}/${file.id}/${fileName}`
        );
        expect(Number(file.size)).toBe(fileBuf.byteLength);

        const [usage] = await sql<
            { used_bytes: string; file_count: number }[]
        >`SELECT used_bytes, file_count FROM storage_usage WHERE user_id = ${userId}`;
        expect(Number(usage.used_bytes)).toBe(fileBuf.byteLength);
        expect(Number(usage.file_count)).toBe(1);
    });

    test('dashboard Storage Usage widget renders after upload', async ({
        page,
    }) => {
        await page.goto('/dashboard');
        await expect(
            page.getByRole('heading', { name: /welcome back, .+/i })
        ).toBeVisible();
        await expect(page.getByText('Storage Usage')).toBeVisible();
        await page.screenshot({
            path: `${SCREENSHOTS}/03-dashboard.png`,
            fullPage: true,
        });
    });

    test('grouped files page shows the auto-created batch from the upload', async ({
        page,
    }) => {
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
        await expect(page.getByText('validate-')).toBeVisible();

        await page.screenshot({
            path: `${SCREENSHOTS}/05-grouped-files-page.png`,
            fullPage: true,
        });
    });

    test('quota soft cap: UI surfaces upload error when over 105%', async ({
        page,
    }) => {
        const userId = await getUserId();
        const sql = getDb();

        // Park usage at exactly 105% of starter — any positive sizeBytes
        // pushes past the soft cap.
        const at105 = Math.floor(PLAN_LIMITS.starter * 1.05);
        await sql`
            UPDATE storage_usage SET used_bytes = ${at105}, file_count = 1
            WHERE user_id = ${userId}
        `;

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
        await page.getByRole('button', { name: /^Upload \d+ files?$/ }).click();

        // UploadZone renders a Retry button + inline error on rejection.
        await expect(
            page.getByRole('button', { name: 'Retry upload' })
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(
            0
        );

        await page.screenshot({
            path: `${SCREENSHOTS}/04-quota-rejected.png`,
            fullPage: true,
        });

        // No file row with the rejected name should have been created.
        const [{ count }] = await sql<{ count: string }[]>`
            SELECT count(*)::text FROM files
            WHERE user_id = ${userId} AND name = ${rejectedName}
        `;
        expect(Number(count)).toBe(0);
    });
});
