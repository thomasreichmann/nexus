/**
 * Backfill a trialing subscription for any user without one.
 *
 * Two populations get caught here:
 *   1. Accounts created before the `databaseHooks.user.create.after` hook
 *      that auto-provisions trials (added in PR #198, 2026-04-06).
 *   2. Accounts whose hook ran but failed silently before the rethrow
 *      hardening — i.e. anyone whose Stripe customer creation errored
 *      transiently between #198 and the matching hardening commit.
 *
 * Idempotent: skips users that already have a subscription row.
 *
 * Usage:
 *   pnpm -F web backfill:trial-subscriptions          # dry run (default)
 *   pnpm -F web backfill:trial-subscriptions --apply  # actually create
 */

import { eq, isNull } from 'drizzle-orm';

import { db } from '@/server/db';
import { subscriptionService } from '@/server/services/subscriptions';
import { subscriptions, user } from '@nexus/db/schema';

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');

    const orphans = await db
        .select({
            id: user.id,
            email: user.email,
            name: user.name,
        })
        .from(user)
        .leftJoin(subscriptions, eq(subscriptions.userId, user.id))
        .where(isNull(subscriptions.id));

    if (orphans.length === 0) {
        console.log('No users without subscriptions. Nothing to do.');
        return;
    }

    console.log(`Found ${orphans.length} user(s) without a subscription row:`);
    for (const u of orphans) {
        console.log(`  - ${u.id}  ${u.email}`);
    }

    if (!apply) {
        console.log(
            '\nDry run (default). Re-run with --apply to provision trials.'
        );
        return;
    }

    console.log('\nProvisioning…');
    let ok = 0;
    let failed = 0;
    for (const u of orphans) {
        try {
            await subscriptionService.provisionTrialSubscription(
                db,
                u.id,
                u.email,
                u.name ?? undefined
            );
            console.log(`  ✓ ${u.id}  ${u.email}`);
            ok += 1;
        } catch (err) {
            console.error(`  ✗ ${u.id}  ${u.email} —`, err);
            failed += 1;
        }
    }

    console.log(`\nDone. ${ok} provisioned, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error('Backfill aborted:', err);
    process.exit(1);
});
