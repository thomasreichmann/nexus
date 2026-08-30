/**
 * Connection-injectable query + cleanup helpers for tests.
 *
 * Unlike `seed/cleanup.ts`, these are NOT seed-prefix-gated — they operate on a
 * specific user's real rows, which is what e2e needs (its rows aren't
 * `seed_`-prefixed). They replace the find/update/delete/upsert/count helpers
 * that used to live in `apps/web/e2e/helpers/db.ts` as hand-written SQL.
 */
import { and, count, eq, notExists, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { createSubscriptionFixture, type User } from '../repositories/fixtures';
import { PLAN_LIMITS, getTrialEnd, type PlanTier } from '../plans';
import { insertStorageUsage } from './inserts';
import type { DB } from '../connection';

export async function findUserByEmail(
    db: DB,
    email: string
): Promise<User | undefined> {
    return db.query.user.findFirst({
        where: eq(schema.user.email, email),
    });
}

export async function updateUserRole(
    db: DB,
    email: string,
    role: User['role']
): Promise<void> {
    await db
        .update(schema.user)
        .set({ role })
        .where(eq(schema.user.email, email));
}

/**
 * Removes ALL of a user's domain data (retrieval_requests → retrievals → files
 * → upload_batches) in FK-safe order, without deleting the user. The single
 * reset for specs that seed file data. Sequential deletes (no transaction) on
 * purpose: e2e runs against Supabase's transaction-mode pooler, where
 * multi-statement transactions can be intermittently lost (see
 * `connection.ts`).
 *
 * Requests go first: their items and artifacts cascade, which is what lets the
 * retrieval and file deletes below stay single statements.
 */
export async function deleteUserData(db: DB, userId: string): Promise<void> {
    await db
        .delete(schema.retrievalRequests)
        .where(eq(schema.retrievalRequests.userId, userId));
    await db
        .delete(schema.retrievals)
        .where(eq(schema.retrievals.userId, userId));
    await db.delete(schema.files).where(eq(schema.files.userId, userId));
    await db
        .delete(schema.uploadBatches)
        .where(eq(schema.uploadBatches.userId, userId));
}

/**
 * `deleteUserData` plus a zeroed `storage_usage` row — the full reset for a
 * spec that actually confirms uploads or parks a user at the quota cap.
 *
 * The usage row is rewritten rather than deleted so the user stays in the same
 * shape a signed-up user has, and because `deleteUserData` deliberately spares
 * it: most specs never touch usage and shouldn't pay to re-seed it.
 */
export async function resetUserData(db: DB, userId: string): Promise<void> {
    await deleteUserData(db, userId);
    await insertStorageUsage(db, { userId, usedBytes: 0, fileCount: 0 });
}

/**
 * Removes a user entirely. All domain tables (files, upload_batches,
 * storage_usage, retrievals, subscriptions) and BetterAuth tables (session,
 * account) cascade on user delete.
 */
export async function deleteUserByEmail(db: DB, email: string): Promise<void> {
    await db.delete(schema.user).where(eq(schema.user.email, email));
}

// Targeted single-row deletes — for fixture teardown and per-row cleanup.

export async function deleteFile(db: DB, id: string): Promise<void> {
    await db.delete(schema.files).where(eq(schema.files.id, id));
}

export async function deleteUploadBatch(db: DB, id: string): Promise<void> {
    await db
        .delete(schema.uploadBatches)
        .where(eq(schema.uploadBatches.id, id));
}

export async function deleteRetrieval(db: DB, id: string): Promise<void> {
    await db.delete(schema.retrievals).where(eq(schema.retrievals.id, id));
}

/**
 * Delete a user's retrieval requests that no longer point at anything.
 *
 * The companion to `deleteRetrieval` for a spec that restores through the UI
 * on a *shared* user, where `deleteUserData` would be too broad. Since #423
 * every restore also writes a `retrieval_requests` row, and deleting the
 * retrieval only cascades the item away — the request survives with nothing
 * behind it, permanently open and permanently inside the readiness poll's
 * `findBuildable` scan. Emptiness is the signal rather than an id because the
 * request is created server-side and the spec never learns its id.
 */
export async function deleteOrphanedRetrievalRequests(
    db: DB,
    userId: string
): Promise<void> {
    await db.delete(schema.retrievalRequests).where(
        and(
            eq(schema.retrievalRequests.userId, userId),
            notExists(
                db
                    .select({ one: sql`1` })
                    .from(schema.retrievalRequestItems)
                    .where(
                        eq(
                            schema.retrievalRequestItems.requestId,
                            schema.retrievalRequests.id
                        )
                    )
            )
        )
    );
}

export async function deleteJob(db: DB, id: string): Promise<void> {
    await db
        .delete(schema.backgroundJobs)
        .where(eq(schema.backgroundJobs.id, id));
}

export async function deleteInvite(db: DB, id: string): Promise<void> {
    await db.delete(schema.invites).where(eq(schema.invites.id, id));
}

// Cleanup for invites created through the UI, where the test never sees the
// row id: email-bound ones are found by their unique test email, link-only
// ones by the token extracted from the displayed invite URL.

export async function deleteInvitesByEmail(
    db: DB,
    email: string
): Promise<void> {
    await db.delete(schema.invites).where(eq(schema.invites.email, email));
}

export async function deleteInviteByToken(
    db: DB,
    token: string
): Promise<void> {
    await db.delete(schema.invites).where(eq(schema.invites.token, token));
}

/**
 * Clears a seeded password-reset token. `verification` has no FK to `user`, so
 * deleting the user leaves the row behind — specs that seed a token clean it up
 * here. Keyed on the token, not the user, so it can't take out the other row
 * kinds that share the table (email verification, 2FA). A completed reset
 * consumes its own row, making this a no-op.
 */
export async function deletePasswordResetToken(
    db: DB,
    token: string
): Promise<void> {
    await db
        .delete(schema.verification)
        .where(eq(schema.verification.identifier, `reset-password:${token}`));
}

/**
 * Upserts the user's subscription to a fresh trial. Used by global setup (the
 * shared e2e users are reused across runs and may pre-date the signup trial
 * hook) and as the `afterEach` reset for specs that flip to paid via
 * `markSubscriptionPaid`. Forcing the columns back means a crash before the
 * reset can't leak paid state into the next run.
 */
export async function ensureTrialSubscription(
    db: DB,
    userId: string
): Promise<void> {
    const row = createSubscriptionFixture({
        userId,
        planTier: 'starter',
        status: 'trialing',
        storageLimit: PLAN_LIMITS.starter,
        stripeCustomerId: `cus_test_${userId}`,
        stripeSubscriptionId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: getTrialEnd(),
    });
    await db
        .insert(schema.subscriptions)
        .values(row)
        .onConflictDoUpdate({
            target: schema.subscriptions.userId,
            set: {
                status: row.status,
                planTier: row.planTier,
                storageLimit: row.storageLimit,
                trialEnd: row.trialEnd,
                stripeSubscriptionId: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
            },
        });
}

/**
 * Promotes a user's trial subscription to active paid. Specs that exercise the
 * paid-user code paths flip the row before the test and reset via
 * `ensureTrialSubscription` after.
 */
export async function markSubscriptionPaid(
    db: DB,
    userId: string,
    options?: { tier?: PlanTier }
): Promise<void> {
    const tier = options?.tier ?? 'pro';
    await db
        .update(schema.subscriptions)
        .set({
            status: 'active',
            planTier: tier,
            stripeSubscriptionId: `sub_test_${userId}`,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
            trialEnd: null,
            cancelAtPeriodEnd: false,
            storageLimit: PLAN_LIMITS[tier],
        })
        .where(eq(schema.subscriptions.userId, userId));
}

/**
 * Flips a user's subscription to a comped sponsored account, mimicking invite
 * provisioning (`planTier: 'max'`, no Stripe subscription, per-invite storage
 * limit). Default limit is 2 TB — deliberately NOT `PLAN_LIMITS.max` (10 TB) —
 * so UI tests prove the page reads the row, not a tier constant. Reset via
 * `ensureTrialSubscription` after.
 */
export async function markSubscriptionSponsored(
    db: DB,
    userId: string,
    options?: { storageLimit?: number }
): Promise<void> {
    await db
        .update(schema.subscriptions)
        .set({
            status: 'sponsored',
            planTier: 'max',
            stripeSubscriptionId: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            trialEnd: null,
            storageLimit: options?.storageLimit ?? 2 * 1024 ** 4,
        })
        .where(eq(schema.subscriptions.userId, userId));
}

export interface JobCounts {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

/**
 * Counts background jobs grouped by status, zero-filling every status so callers
 * can read e.g. `counts.processing` as 0 (not undefined) when none exist — the
 * admin-jobs empty-state test relies on this.
 */
export async function countJobsByStatus(db: DB): Promise<JobCounts> {
    const rows = await db
        .select({ status: schema.backgroundJobs.status, count: count() })
        .from(schema.backgroundJobs)
        .groupBy(schema.backgroundJobs.status);

    const counts: JobCounts = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
    };
    for (const row of rows) {
        if (row.status in counts) {
            counts[row.status as keyof JobCounts] = Number(row.count);
        }
    }
    return counts;
}
