/**
 * Manual validation: a single-file restore completes and is announced by the
 * deployed worker's poll (#437), against real S3 and the real dev Lambdas.
 *
 * Run with:  pnpm -F web test:e2e:validate single-file-restore.spec.ts
 *
 * Needs the AWS CLI on PATH with an operator profile, for the poll invoke the
 * app's own credentials deliberately cannot do (see `awsAsOperator` in the
 * zip-pipeline sibling this spec is cut down from).
 *
 * The object is PUT in STANDARD, so `initiateRestore`'s warm short-circuit
 * settles the retrieval in one hop — which is exactly the path #437 calls out:
 * a row the poll's work list never selects, reachable only by the reconciling
 * `findDirectDeliverable` scan. The *row* still looks cold to the UI because
 * `isLikelyArchived` derives coldness from size + age, not from S3, so the
 * Retrieve button lights up without a 48h Glacier wait.
 *
 * What it mutates (destructive — dev DB + the dev files bucket):
 *  - PUTs one real object into the files bucket and deletes it after
 *  - Creates one dedicated user (cascades away on worker teardown)
 *  - Invokes the deployed dev worker's poll once, rather than waiting out the
 *    15-minute EventBridge schedule
 *
 * The email itself is sent from the Lambda and is out of reach of a browser;
 * what this spec proves is everything the send is gated on — the completion
 * flip on a warm single-file request, with no zip artifacts minted — plus the
 * `?file=` deep link the email points at.
 */
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { count, desc, eq } from 'drizzle-orm';
import { insertFile, deleteUserData } from '@nexus/db/test-db';
import { originalKey } from '@nexus/db/repo/files';
import {
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '@nexus/db/objectState';
import {
    retrievalArtifacts,
    retrievalRequestItems,
    retrievalRequests,
    retrievals,
} from '@nexus/db/schema';
import { test as base, expect } from '../fixtures';
import { invokePoll, retrievalStatuses } from '../helpers/aws';
import { createTestS3, type TestS3 } from '../helpers/s3';
import { type TestUser } from '../helpers/auth';
import type { File } from '@nexus/db/test-db';

const RESTORE_USER: TestUser = {
    email: 'single-file-restore-validate@test.local',
    password: 'single-file-restore-validate-password-123',
    name: 'Single File Restore Validate',
};
const STATE_PATH = 'e2e/.auth/single-file-restore-validate.json';
const SCREENSHOTS = 'test-results/validate/single-file-restore';

const FILE_NAME = '_MG_5102.CR2';
const FILE_SIZE = 150_000;

const test = base.extend<
    NonNullable<unknown>,
    { seededRestoreFile: File; s3: TestS3 }
>({
    s3: [
        async ({}, use) => {
            await use(createTestS3());
        },
        { scope: 'worker' },
    ],

    seededRestoreFile: [
        async ({ db, dedicatedUser, s3 }, use) => {
            const userId = dedicatedUser!.userId;
            const stamp = Date.now();
            const fileId = crypto.randomUUID();
            const s3Key = originalKey({
                userId,
                batchId: `validate-single-${stamp}`,
                id: fileId,
                name: FILE_NAME,
            });
            // STANDARD, not DEEP_ARCHIVE: the point is the warm short-circuit,
            // today. The row still reads as archived to the UI.
            await s3.client.send(
                new PutObjectCommand({
                    Bucket: s3.bucket,
                    Key: s3Key,
                    Body: Buffer.alloc(FILE_SIZE, 0xa7),
                    StorageClass: 'STANDARD',
                })
            );
            // 5 days old, comfortably past LIFECYCLE_TRANSITION_LAG_HOURS.
            const createdAt = new Date(stamp - 5 * 24 * 3_600_000);
            const file = await insertFile(db, {
                id: fileId,
                userId,
                name: FILE_NAME,
                size: FILE_SIZE,
                mimeType: 'application/octet-stream',
                s3Key,
                status: 'available',
                createdAt,
                updatedAt: createdAt,
            });
            expect(file.size).toBeGreaterThan(LIFECYCLE_TRANSITION_MIN_BYTES);

            await use(file);

            await s3.client.send(
                new DeleteObjectCommand({ Bucket: s3.bucket, Key: file.s3Key })
            );
            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.use({
    dedicatedUserConfig: { user: RESTORE_USER, statePath: STATE_PATH },
});

test(
    'a single-file restore completes via the poll with no zip minted',
    { tag: ['@page:/dashboard/files', '@uc:files-request-retrieval-single'] },
    async ({ page, db, seededRestoreFile, s3, dedicatedUser }) => {
        // One queue hop (initiate-restore) and one poll invoke, each with a
        // possible cold start.
        test.setTimeout(300_000);
        const userId = dedicatedUser!.userId;

        await page.goto('/dashboard/files');
        const selectAll = page.getByRole('checkbox', { name: 'Select all' });
        await expect(selectAll).toBeVisible();
        await selectAll.click();

        await page.getByRole('button', { name: 'Retrieve' }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog.getByText('Retrieve 1 file?')).toBeVisible();
        await page.screenshot({
            path: `${SCREENSHOTS}/01-dialog.png`,
            fullPage: true,
        });
        await dialog.getByRole('button', { name: 'Retrieve' }).click();

        // Single-file copy, not the bulk "Retrieval requested for N files" —
        // see toastRetrievalRequested in retrievalFeedback.ts.
        await expect(
            page.getByText('Retrieval request submitted')
        ).toBeVisible();

        // --- the request path wrote rows only, at the single-file window ---
        const [request] = await db
            .select()
            .from(retrievalRequests)
            .where(eq(retrievalRequests.userId, userId))
            .orderBy(desc(retrievalRequests.createdAt))
            .limit(1);
        expect(request).toBeDefined();
        expect(request.completedAt).toBeNull();

        // #424's restore-window split, the other half of the zip spec's
        // assertion: the thawed copy *is* the download here, so it buys the
        // full 7 days rather than the build-only 2.
        const daysRows = await db
            .select({ days: retrievals.restoreDaysToKeep })
            .from(retrievalRequestItems)
            .innerJoin(
                retrievals,
                eq(retrievals.id, retrievalRequestItems.retrievalId)
            )
            .where(eq(retrievalRequestItems.requestId, request.id));
        expect(daysRows).toHaveLength(1);
        expect(daysRows[0].days).toBe(DEFAULT_RESTORE_DAYS_TO_KEEP);

        // --- the deployed worker's initiate-restore settles the warm row ---
        // This is the short-circuit: the row goes pending -> ready without
        // ever entering the poll's work list.
        await expect
            .poll(() => retrievalStatuses(db, request.id), {
                timeout: 120_000,
                intervals: [2000, 3000, 5000],
            })
            .toEqual(['ready']);

        // --- #437: the poll's reconciling scan completes and announces ---
        invokePoll(s3.bucket);

        await expect
            .poll(
                async () => {
                    const [row] = await db
                        .select({
                            completedAt: retrievalRequests.completedAt,
                        })
                        .from(retrievalRequests)
                        .where(eq(retrievalRequests.id, request.id));
                    return row.completedAt !== null;
                },
                { timeout: 120_000, intervals: [3000, 5000, 5000] }
            )
            .toBe(true);

        // Direct delivery, not a zip: the thawed original is the download, so
        // the request completed with no artifact rows ever minted.
        const [artifactCount] = await db
            .select({ value: count() })
            .from(retrievalArtifacts)
            .where(eq(retrievalArtifacts.requestId, request.id));
        expect(artifactCount.value).toBe(0);

        // The deep link the ready email points at (`?file=`, the sibling of
        // the zip spec's `?request=`): the file browser scrolls to and
        // highlights the restored file, ready for its Download action.
        await page.goto(`/dashboard/files?file=${seededRestoreFile.id}`);
        // The row, not the name text: MiddleTruncateName keeps the full name
        // in an sr-only span (hidden by design), so hasText finds it while
        // toBeVisible on the text node itself never could.
        await expect(
            page.getByRole('row').filter({ hasText: FILE_NAME })
        ).toBeVisible();
        await page.screenshot({
            path: `${SCREENSHOTS}/02-deep-link.png`,
            fullPage: true,
        });
    }
);
