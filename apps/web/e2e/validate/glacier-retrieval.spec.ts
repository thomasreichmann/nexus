/**
 * Manual validation: retrieval rows written before the S3 restore
 * (#329 / PR #348).
 *
 * Run with:  pnpm -F web test:e2e:validate glacier-retrieval.spec.ts
 *
 * What it mutates (destructive — dev DB + dev S3 bucket):
 *  - PUTs one ~35-byte object into the S3 dev bucket directly in
 *    DEEP_ARCHIVE, fires a real Glacier restore against it, and deletes it
 *    afterwards (early-delete charge on a few bytes, fractions of a cent)
 *  - Seeds and removes one `files` row + its `retrievals` rows for
 *    REGULAR_USER; the rest of that user's data is left alone
 *
 * What it covers — the manual step in PR #348's test plan: trigger a
 * retrieval on an archived file with S3 reachable and confirm the success
 * toast. The integration test mocks AWS, so this is the only place the real
 * RestoreObject call, its credentials, and the object's actual storage class
 * are exercised together. Assertions go past the toast: the row must be
 * `pending` (not `failed`) with no `errorMessage`, and S3 must report
 * `ongoing-request="true"` — a real restore in flight, with a row tracking it.
 *
 * Not covered (intentional): the partial-failure toast. Making one key fail
 * against real S3 means seeding a file whose object doesn't exist, which
 * tests AWS's error rather than ours — the integration test
 * (`partial S3 restore failure (#329)`) owns that path.
 */
import { test, expect } from '../fixtures';
import {
    DeleteObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { Connection, File } from '@nexus/db/test-db';
import { insertFile, deleteFile, deleteRetrieval } from '@nexus/db/test-db';
import { originalKey } from '@nexus/db/repo/files';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { createTestS3, getStorageClass, type TestS3 } from '../helpers/s3';
import { fileName } from '../helpers/table';

test.describe.configure({ mode: 'serial' });
test.use({ userRole: 'user' });

const SCREENSHOTS = 'test-results/validate/glacier-retrieval';

// Built in a hook, never at module scope: the coverage gate imports every
// spec — including this env-gated tier — with no credentials, so a top-level
// createTestS3() throws at import and takes the whole gate down with it.
let s3: TestS3;
test.beforeAll(() => {
    s3 = createTestS3();
});

let seededFile: File | undefined;
// Tracked separately from seededFile and assigned before the PUT: if the
// DB insert fails after the object is written, cleanup must still delete
// it — a leaked DEEP_ARCHIVE object carries a 180-day minimum charge.
let seededS3Key: string | undefined;

// The object has to be genuinely archived: RestoreObject on a STANDARD object
// fails with InvalidObjectState, so a green run against one would prove
// nothing. The bucket's lifecycle rule transitions on day 0, but it runs
// asynchronously (up to 48h after upload), so PUT straight into DEEP_ARCHIVE.
async function seedArchivedFile(db: Connection, userId: string): Promise<File> {
    const name = `validate-retrieval-${Date.now()}.txt`;
    const fileId = crypto.randomUUID();
    const body = 'nexus glacier retrieval validation\n';
    // Real S3 object, so it must sit at the real key shape. The batch slot is
    // a stand-in: this spec seeds the file row directly and never uploads
    // through a batch.
    const s3Key = originalKey({
        userId,
        batchId: 'validate-329',
        id: fileId,
        name,
    });

    seededS3Key = s3Key;
    await s3.client.send(
        new PutObjectCommand({
            Bucket: s3.bucket,
            Key: s3Key,
            Body: body,
            StorageClass: 'DEEP_ARCHIVE',
        })
    );

    return insertFile(db, {
        id: fileId,
        userId,
        name,
        size: body.length,
        mimeType: 'text/plain',
        s3Key,
        storageTier: 'deep_archive',
        status: 'available',
    });
}

async function getRestoreHeader(key: string): Promise<string> {
    const head = await s3.client.send(
        new HeadObjectCommand({ Bucket: s3.bucket, Key: key })
    );
    return head.Restore ?? '';
}

test.describe('glacier retrieval against real S3', () => {
    test.afterAll(async ({ db }) => {
        if (seededFile) {
            const retrievals = await createRetrievalRepo(db).findByUser(
                seededFile.userId
            );
            for (const retrieval of retrievals) {
                if (retrieval.fileId === seededFile.id) {
                    await deleteRetrieval(db, retrieval.id);
                }
            }
            await deleteFile(db, seededFile.id);
        }
        // Keyed on seededS3Key, not seededFile: the object exists as soon as
        // the PUT lands, before the DB insert. S3 delete is idempotent, so a
        // key whose PUT itself failed deletes harmlessly.
        if (seededS3Key) {
            await s3.client.send(
                new DeleteObjectCommand({
                    Bucket: s3.bucket,
                    Key: seededS3Key,
                })
            );
        }
    });

    test(
        'retrieve on an archived file starts a real restore and toasts success',
        {
            tag: [
                '@page:/dashboard/files',
                '@uc:files-request-retrieval-single',
            ],
        },
        async ({ page, db, seedUserId: userId }) => {
            const file = await seedArchivedFile(db, userId);
            seededFile = file;
            expect(await getStorageClass(s3, file.s3Key)).toBe('DEEP_ARCHIVE');
            expect(await getRestoreHeader(file.s3Key)).toBe('');

            await page.goto('/dashboard/files');
            await expect(fileName(page, file.name)).toBeVisible();

            await page
                .locator('tr', { hasText: file.name })
                .getByRole('button', { name: 'Actions' })
                .click();
            await page
                .getByRole('menuitem', { name: 'Request retrieval' })
                .click();

            const dialog = page.getByRole('alertdialog');
            await expect(dialog.getByText('Retrieve 1 file?')).toBeVisible();
            await page.screenshot({
                path: `${SCREENSHOTS}/01-dialog.png`,
                fullPage: true,
            });
            await dialog.getByRole('button', { name: 'Retrieve' }).click();

            await expect(
                page.getByText('Retrieval request submitted')
            ).toBeVisible();
            await expect(page.getByText(/could not be started/)).toHaveCount(0);
            await page.screenshot({
                path: `${SCREENSHOTS}/02-success-toast.png`,
                fullPage: true,
            });

            // The row is the point of #329: it exists, it survived the S3
            // call, and it is pending rather than failed.
            const retrieval = await createRetrievalRepo(db).findLatestByFileId(
                file.id
            );
            expect(retrieval).toBeDefined();
            expect(retrieval!.status).toBe('pending');
            expect(retrieval!.errorMessage).toBeNull();
            expect(retrieval!.initiatedAt).not.toBeNull();

            // AWS actually took the restore: the Restore header appears only
            // once RestoreObject has been accepted for this object.
            await expect
                .poll(() => getRestoreHeader(file.s3Key), {
                    timeout: 20_000,
                    intervals: [1000, 2000, 3000],
                })
                .toContain('ongoing-request="true"');

            // And the list reflects it after the mutation's invalidation.
            await expect(
                page
                    .locator('tr', { hasText: file.name })
                    .getByText(/Retrieving/i)
                    .first()
            ).toBeVisible();
            await page.screenshot({
                path: `${SCREENSHOTS}/03-retrieving-row.png`,
                fullPage: true,
            });
        }
    );
});
