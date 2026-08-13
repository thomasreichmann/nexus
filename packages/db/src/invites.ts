import type { Invite } from './repositories/invites';

/**
 * Expiry is derived, never stored — an invite past its `expiresAt` keeps the
 * `pending` DB status (there is no sweeper flipping it). Every surface that
 * reports invite state has to apply this rule itself, so it lives here rather
 * than being retyped: the redemption check, the trial-provisioning pre-check,
 * and the admin list badge must all agree on when a link stops working.
 *
 * Lives in its own dependency-free module rather than in the invites
 * repository (which the `claim` SQL gate re-exports it from) because the admin
 * list badge is a client component: a value import from the repository would
 * drag drizzle's query builders into the browser bundle for a date comparison.
 * Same reason `plans.ts` holds `getTrialEnd` (#364).
 *
 * `null` means "never expires". The bound is inclusive: an invite is expired
 * the instant it reaches `expiresAt`.
 */
export function isInviteExpired(
    invite: Pick<Invite, 'status' | 'expiresAt'>,
    now: Date = new Date()
): boolean {
    return (
        invite.status === 'pending' &&
        invite.expiresAt !== null &&
        invite.expiresAt <= now
    );
}
