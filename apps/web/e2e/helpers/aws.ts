/**
 * Operator-profile AWS helpers for the validate tier.
 *
 * Everything here shells out to the AWS CLI as the *operator*, not as the app:
 * .env.local's credentials are the `nexus-app-*` IAM user, which by design has
 * no `lambda:InvokeFunction` — invoking the deployed worker is an operator
 * action, not something the web app is ever allowed to do. So `awsAsOperator`
 * drops those variables and falls back to the ambient profile rather than the
 * policy being widened to suit a test.
 *
 * Module scope stays import-clean (no env reads, no clients) so the coverage
 * gate can list the validate specs without credentials.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { retrievalRequestItems, retrievals } from '@nexus/db/schema';
import type { Connection } from '@nexus/db/test-db';

/** The env this run points at, read off the bucket the S3 helper resolved. */
export function envSuffix(bucket: string): string {
    const suffix = bucket.replace(/^nexus-storage-files-/, '');
    if (suffix === bucket) {
        throw new Error(`Unexpected S3_BUCKET shape: ${bucket}`);
    }
    return suffix;
}

/** Run the AWS CLI with the app's credentials stripped (see module docblock). */
export function awsAsOperator(args: string[]): void {
    const env = { ...process.env };
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    execFileSync('aws', args, { stdio: 'pipe', env });
}

/**
 * Run the deployed worker's retrieval poll now instead of waiting out the
 * 15-minute schedule. Any event without `Records` is the poll (handler.ts), so
 * an empty payload is exactly what EventBridge delivers. Shelled out rather
 * than done through the SDK because @aws-sdk/client-lambda is not a dependency
 * of the app.
 *
 * The response payload is checked because `aws lambda invoke` exits 0 even
 * when the function itself threw — without this, a poll that raised is
 * indistinguishable from one that ran, until some later assertion times out.
 */
export function invokePoll(bucket: string): void {
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
    const payload = readFileSync(out, 'utf8');
    if (payload.includes('"errorType"')) {
        throw new Error(`Worker poll invocation failed: ${payload}`);
    }
}

/** Statuses of the retrievals behind one request, sorted for comparison. */
export async function retrievalStatuses(
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
