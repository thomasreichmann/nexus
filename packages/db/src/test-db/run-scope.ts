/**
 * Run-scoped e2e identities (#484). Every `playwright test` invocation signs up
 * its own users on the shared dev DB, so two runs at once (two agents, or a
 * local run beside CI) can't reset or delete each other's users mid-test.
 *
 * The naming and the sweep live together here: the sweep finds leftovers by
 * the marker `runScopedEmail` writes, and must never match anything else.
 */
import { and, like, lt } from 'drizzle-orm';
import * as schema from '../schema';
import { deleteUsers } from './queries';
import type { DB } from '../connection';

const RUN_MARKER = '--run-';
const E2E_DOMAIN = '@test.local';

/**
 * `admin-e2e@test.local` → `admin-e2e--run-<runId>@test.local`, plus
 * `-w<workerIndex>` for a user one Playwright worker owns. Only `@test.local`
 * addresses are accepted, because the sweep only looks there.
 */
export function runScopedEmail(
    email: string,
    runId: string,
    workerIndex?: number
): string {
    if (!email.endsWith(E2E_DOMAIN)) {
        throw new Error(`e2e identities must be ${E2E_DOMAIN}: ${email}`);
    }
    const local = email.slice(0, -E2E_DOMAIN.length);
    const worker = workerIndex === undefined ? '' : `-w${workerIndex}`;
    return `${local}${RUN_MARKER}${runId}${worker}${E2E_DOMAIN}`;
}

/**
 * Deletes run-scoped users created before `createdBefore`, with everything
 * they own. A run deletes its own users when it ends, so these are the ones a
 * killed run left behind. The cutoff has to be older than any run still in
 * flight, or the sweep deletes a live run's users.
 */
export async function deleteStaleRunScopedUsers(
    db: DB,
    createdBefore: Date
): Promise<void> {
    const stale = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(
            and(
                like(schema.user.email, `%${RUN_MARKER}%${E2E_DOMAIN}`),
                lt(schema.user.createdAt, createdBefore)
            )
        );
    await deleteUsers(
        db,
        stale.map((row) => row.id)
    );
}
