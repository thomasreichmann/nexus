/**
 * Manual validation: the zip build pipeline end-to-end against real S3
 * (#424 / PR #431), plus the bulk-by-default request path (#423 / PR #430).
 *
 * Run with:  pnpm -F web test:e2e:validate zip-pipeline.spec.ts
 *
 * Needs the AWS CLI on PATH with an operator profile, for the two steps the
 * app's own credentials deliberately cannot do (see `awsAsOperator`).
 *
 * Both PRs shipped with this path explicitly unverified — #431's test plan
 * says "End-to-end against real S3/Glacier — not run: needs a real restore
 * cycle (48h on Bulk)". This spec removes that wait without weakening the
 * test: the objects are PUT in STANDARD, so `initiateRestore`'s warm
 * short-circuit (`isReadable` -> mark ready) settles them in one hop, while
 * the *rows* look cold to the UI because `isLikelyArchived` derives coldness
 * from size + age, not from S3. Everything downstream of "the last file
 * thawed" — findBuildable, the partition, the artifact rows, the streaming
 * STORE build, the multipart upload, the completion flip — then runs for real
 * against real S3, which is the half nothing has ever exercised outside mocks.
 *
 * What it mutates (destructive — dev DB + both dev S3 buckets):
 *  - PUTs three real objects into the files bucket and deletes them after
 *  - Builds one real zip into nexus-retrieval-artifacts-<env> and deletes it
 *  - Creates one dedicated user (cascades away on worker teardown)
 *  - Invokes the deployed dev worker's poll once, rather than waiting out the
 *    15-minute EventBridge schedule
 *
 * Not covered: a genuinely cold (DEEP_ARCHIVE) source. That is what
 * validate/glacier-retrieval.spec.ts owns, and joining the two would mean a
 * 48h test.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { desc, eq } from 'drizzle-orm';
import { insertFile, deleteUserData } from '@nexus/db/test-db';
import { originalKey } from '@nexus/db/repo/files';
import {
    ZIP_BUILD_RESTORE_DAYS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '@nexus/db/objectState';
import {
    retrievalArtifacts,
    retrievalRequestItems,
    retrievalRequests,
    retrievals,
} from '@nexus/db/schema';
import { test as base, expect } from '../fixtures';
import { createTestS3, type TestS3 } from '../helpers/s3';
import { type TestUser } from '../helpers/auth';
import type { Connection, File } from '@nexus/db/test-db';

const ZIP_USER: TestUser = {
    email: 'zip-pipeline-validate@test.local',
    password: 'zip-pipeline-validate-password-123',
    name: 'Zip Pipeline Validate',
};
const STATE_PATH = 'e2e/.auth/zip-pipeline-validate.json';
const SCREENSHOTS = 'test-results/validate/zip-pipeline';

/**
 * Three files, chosen for what they prove about the *real* zip writer rather
 * than for coverage of the browser: two share a name (the disambiguation path,
 * which only ever ran against a mocked S3), one carries non-ASCII (the UTF-8
 * general-purpose bit), and every one is over the 128 KB lifecycle floor so
 * `isLikelyArchived` reports it cold and the Retrieve button lights up.
 */
const SEED_SPECS = [
    { name: '_MG_4501.CR2', size: 200_000, fill: 0xa7 },
    { name: '_MG_4501.CR2', size: 150_000, fill: 0x3c },
    { name: 'café ☕ notes.txt', size: 140_000, fill: 0x5e },
] as const;

const EXPECTED_ENTRIES = [
    '_MG_4501.CR2',
    '_MG_4501 (2).CR2',
    'café ☕ notes.txt',
];

interface SeededFile {
    file: File;
    body: Buffer;
}

function makeBody(size: number, fill: number): Buffer {
    const body = Buffer.alloc(size, fill);
    // A constant-byte body would compress to nothing and hide a STORE/DEFLATE
    // mix-up in the size assertions, so vary it.
    for (let i = 0; i < size; i += 7) body[i] = (i * 31 + fill) & 0xff;
    return body;
}

function sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

/** The env this run points at, read off the bucket the helper resolved. */
function envSuffix(bucket: string): string {
    const suffix = bucket.replace(/^nexus-storage-files-/, '');
    if (suffix === bucket) {
        throw new Error(`Unexpected S3_BUCKET shape: ${bucket}`);
    }
    return suffix;
}

/**
 * Run the deployed worker's retrieval poll now instead of waiting out the
 * 15-minute schedule. Any event without `Records` is the poll (handler.ts), so
 * an empty payload is exactly what EventBridge delivers. Shelled out rather
 * than done through the SDK because @aws-sdk/client-lambda is not a dependency
 * of the app and this is its only caller.
 */
/**
 * Run the AWS CLI as the *operator*, not as the app.
 *
 * .env.local's credentials are the `nexus-app-*` IAM user, which by design has
 * neither `lambda:InvokeFunction` nor any grant on the retrieval-artifacts
 * bucket (#431 gave that bucket to the worker role only). Both are correct
 * least privilege, so the two operator-shaped steps below drop those variables
 * and fall back to the ambient profile rather than the policies being widened
 * to suit a test.
 */
function awsAsOperator(args: string[]): void {
    const env = { ...process.env };
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    execFileSync('aws', args, { stdio: 'pipe', env });
}

/**
 * Run the deployed worker's retrieval poll now instead of waiting out the
 * 15-minute schedule. Any event without `Records` is the poll (handler.ts), so
 * an empty payload is exactly what EventBridge delivers.
 */
function invokePoll(bucket: string): void {
    const out = join(mkdtempSync(join(tmpdir(), 'nexus-poll-')), 'out.json');
    awsAsOperator([
        'lambda',
        'invoke',
        '--function-name',
        `nexus-worker-${envSuffix(bucket)}`,
        '--payload',
        '{}',
        '--cli-binary-format',
        'raw-in-base64-out',
        out,
    ]);
}

interface ZipEntry {
    name: string;
    /** 0 = STORE. */
    method: number;
    /** General-purpose bit 11, the "name and comment are UTF-8" flag. */
    utf8Flag: boolean;
}

/**
 * Read the zip's central directory straight from the bytes.
 *
 * Deliberately not Info-ZIP: `zipinfo` re-encodes entry names into the calling
 * process's locale, so a correctly stored UTF-8 name comes back mangled under a
 * Playwright child with no LANG, which reads as a zip-writer bug when it isn't
 * one. The raw bytes are also the only place the UTF-8 flag and the compression
 * method can be asserted without trusting a second tool's interpretation.
 */
function readCentralDirectory(zip: Buffer): ZipEntry[] {
    const eocd = zip.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (eocd < 0) throw new Error('No end-of-central-directory record found');

    const count = zip.readUInt16LE(eocd + 10);
    let offset = zip.readUInt32LE(eocd + 16);
    const entries: ZipEntry[] = [];

    for (let i = 0; i < count; i++) {
        if (zip.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error(`Bad central-directory header at ${offset}`);
        }
        const flags = zip.readUInt16LE(offset + 8);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        entries.push({
            name: zip
                .subarray(offset + 46, offset + 46 + nameLength)
                .toString('utf8'),
            method: zip.readUInt16LE(offset + 10),
            utf8Flag: (flags & 0x800) !== 0,
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** Statuses of the retrievals behind one request, sorted for comparison. */
async function retrievalStatuses(
    db: Connection,
    requestId: string
): Promise<string[]> {
    const rows = await db
        .select({ status: retrievals.status })
        .from(retrievalRequestItems)
        .innerJoin(
            retrievals,
            eq(retrievals.id, retrievalRequestItems.retrievalId)
        )
        .where(eq(retrievalRequestItems.requestId, requestId));
    return rows.map((row) => row.status).sort();
}

const test = base.extend<
    NonNullable<unknown>,
    { seededFiles: SeededFile[]; s3: TestS3 }
>({
    s3: [
        async ({}, use) => {
            await use(createTestS3());
        },
        { scope: 'worker' },
    ],

    seededFiles: [
        async ({ db, dedicatedUser, s3 }, use) => {
            const userId = dedicatedUser!.userId;
            const stamp = Date.now();
            const seeded: SeededFile[] = [];

            for (const [index, spec] of SEED_SPECS.entries()) {
                const fileId = crypto.randomUUID();
                const body = makeBody(spec.size, spec.fill);
                const s3Key = originalKey({
                    userId,
                    batchId: `validate-zip-${stamp}`,
                    id: fileId,
                    name: spec.name,
                });
                // STANDARD, not DEEP_ARCHIVE: the point is to reach the zip
                // builder today. The row still reads as archived to the UI.
                await s3.client.send(
                    new PutObjectCommand({
                        Bucket: s3.bucket,
                        Key: s3Key,
                        Body: body,
                        StorageClass: 'STANDARD',
                    })
                );
                // 5 days old, comfortably past LIFECYCLE_TRANSITION_LAG_HOURS,
                // and staggered so the s3Key sort order is deterministic.
                const createdAt = new Date(
                    stamp - 5 * 24 * 3_600_000 + index * 1000
                );
                const file = await insertFile(db, {
                    id: fileId,
                    userId,
                    name: spec.name,
                    size: body.length,
                    mimeType: 'application/octet-stream',
                    s3Key,
                    status: 'available',
                    createdAt,
                    updatedAt: createdAt,
                });
                expect(file.size).toBeGreaterThan(
                    LIFECYCLE_TRANSITION_MIN_BYTES
                );
                seeded.push({ file, body });
            }

            await use(seeded);

            for (const { file } of seeded) {
                await s3.client.send(
                    new DeleteObjectCommand({
                        Bucket: s3.bucket,
                        Key: file.s3Key,
                    })
                );
            }
            await deleteUserData(db, userId);
        },
        { scope: 'worker' },
    ],
});

test.describe.configure({ mode: 'serial' });
test.use({ dedicatedUserConfig: { user: ZIP_USER, statePath: STATE_PATH } });

test(
    'a bulk retrieve builds a real, openable zip in the artifacts bucket',
    { tag: ['@page:/dashboard/files', '@uc:files-bulk-retrieve'] },
    async ({ page, db, seededFiles, s3, dedicatedUser }) => {
        // Two queue hops and two possible cold starts: the initiate-restore
        // job, then the poll's zip job on the second Lambda.
        test.setTimeout(300_000);
        const userId = dedicatedUser!.userId;

        await page.goto('/dashboard/files');
        const selectAll = page.getByRole('checkbox', { name: 'Select all' });
        await expect(selectAll).toBeVisible();
        await selectAll.click();
        await page.screenshot({
            path: `${SCREENSHOTS}/01-selected.png`,
            fullPage: true,
        });

        await page.getByRole('button', { name: 'Retrieve' }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog.getByText('Retrieve 3 files?')).toBeVisible();
        await page.screenshot({
            path: `${SCREENSHOTS}/02-dialog.png`,
            fullPage: true,
        });
        await dialog.getByRole('button', { name: 'Retrieve' }).click();

        await expect(
            page.getByText('Retrieval requested for 3 files')
        ).toBeVisible();
        await page.screenshot({
            path: `${SCREENSHOTS}/03-requested.png`,
            fullPage: true,
        });

        // --- #423: the request path wrote rows only, at the bulk default ---
        const [request] = await db
            .select()
            .from(retrievalRequests)
            .where(eq(retrievalRequests.userId, userId))
            .orderBy(desc(retrievalRequests.createdAt))
            .limit(1);
        expect(request).toBeDefined();
        expect(request.tier).toBe('bulk');
        expect(request.completedAt).toBeNull();

        const items = await db
            .select({ id: retrievalRequestItems.id })
            .from(retrievalRequestItems)
            .where(eq(retrievalRequestItems.requestId, request.id));
        expect(items).toHaveLength(3);

        // #424's restore-window split: a multi-file request only needs the
        // originals to outlive the build, so it buys 2 days rather than 7.
        const daysRows = await db
            .select({ days: retrievals.restoreDaysToKeep })
            .from(retrievalRequestItems)
            .innerJoin(
                retrievals,
                eq(retrievals.id, retrievalRequestItems.retrievalId)
            )
            .where(eq(retrievalRequestItems.requestId, request.id));
        expect(daysRows).toHaveLength(3);
        for (const row of daysRows) {
            expect(row.days).toBe(ZIP_BUILD_RESTORE_DAYS);
        }

        // --- the deployed worker's initiate-restore settles the warm rows ---
        await expect
            .poll(() => retrievalStatuses(db, request.id), {
                timeout: 120_000,
                intervals: [2000, 3000, 5000],
            })
            .toEqual(['ready', 'ready', 'ready']);

        // --- #424: the poll partitions and the zip Lambda builds ---
        invokePoll(s3.bucket);

        await expect
            .poll(
                async () => {
                    const rows = await db
                        .select({
                            status: retrievalArtifacts.status,
                            error: retrievalArtifacts.error,
                        })
                        .from(retrievalArtifacts)
                        .where(eq(retrievalArtifacts.requestId, request.id));
                    // Surfaced rather than swallowed: a `failed` artifact
                    // otherwise just times out as "never became ready".
                    return rows.map((row) => row.error ?? row.status).sort();
                },
                { timeout: 180_000, intervals: [3000, 5000, 5000] }
            )
            .toEqual(['ready']);

        const [artifact] = await db
            .select()
            .from(retrievalArtifacts)
            .where(eq(retrievalArtifacts.requestId, request.id));
        // Under 4 GB and 10,000 entries, so exactly one chunk.
        expect(artifact.position).toBe(0);
        expect(artifact.s3Key).toBe(
            `${userId}/${request.id}/${artifact.id}/nexus-part-1.zip`
        );

        // --- the completion flip, which #426 will hang its one email off ---
        const [completed] = await db
            .select({ completedAt: retrievalRequests.completedAt })
            .from(retrievalRequests)
            .where(eq(retrievalRequests.id, request.id));
        expect(completed.completedAt).not.toBeNull();

        // --- the archive itself, read back out of the artifacts bucket ---
        const artifactsBucket = `nexus-retrieval-artifacts-${envSuffix(s3.bucket)}`;
        const dir = mkdtempSync(join(tmpdir(), 'nexus-zip-'));
        const zipPath = join(dir, 'part1.zip');
        awsAsOperator([
            's3api',
            'get-object',
            '--bucket',
            artifactsBucket,
            '--key',
            artifact.s3Key!,
            zipPath,
        ]);
        expect(readFileSync(zipPath).length).toBe(artifact.sizeBytes);

        // Info-ZIP, because an independent unarchiver accepting the file is the
        // assertion that matters, and it is the one #431 could not run against
        // a real build. Only the CRC/structure check is taken from it: its
        // *listing* transcodes entry names into the calling process's locale,
        // which has no LANG under Playwright and turns a stored-correctly '☕'
        // into '?'. The names are read from the bytes below instead.
        execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });

        const zipBytes = readFileSync(zipPath);
        const entries = readCentralDirectory(zipBytes);
        expect(entries.map((e) => e.name).sort()).toEqual(
            [...EXPECTED_ENTRIES].sort()
        );
        for (const entry of entries) {
            // STORE, which is what keeps the build streaming and the sizes
            // predictable...
            expect(entry.method).toBe(0);
            // ...and bit 11, without which an unarchiver reads the name as
            // CP437 and mangles anything non-ASCII.
            expect(entry.utf8Flag).toBe(true);
        }
        // No zip64 record: the 4 GB partition cap exists so 32-bit offsets
        // always suffice, and Windows Explorer is the reason it matters.
        expect(zipBytes.includes(Buffer.from('PK\x06\x07', 'latin1'))).toBe(
            false
        );

        const extractDir = join(dir, 'out');
        execFileSync('unzip', ['-q', zipPath, '-d', extractDir], {
            stdio: 'pipe',
        });
        const extracted = readdirSync(extractDir);
        expect(extracted).toHaveLength(3);

        // Byte-identical: the streaming GetObject -> yazl -> multipart chain
        // did not truncate, reorder, or re-encode anything.
        const expectedHashes = seededFiles.map((s) => sha256(s.body)).sort();
        const actualHashes = extracted
            .map((name) => sha256(readFileSync(join(extractDir, name))))
            .sort();
        expect(actualHashes).toEqual(expectedHashes);

        await page.reload();
        await page.screenshot({
            path: `${SCREENSHOTS}/04-after-build.png`,
            fullPage: true,
        });

        // Tidy the artifact; the lifecycle rule would otherwise take 7 days.
        awsAsOperator([
            's3api',
            'delete-object',
            '--bucket',
            artifactsBucket,
            '--key',
            artifact.s3Key!,
        ]);
    }
);
