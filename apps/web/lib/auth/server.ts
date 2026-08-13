import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '@nexus/db/schema';
import { RESET_PASSWORD_TOKEN_TTL_SECONDS } from '@/lib/auth/constants';
import { env } from '@/lib/env';
import { db } from '@/server/db';
import { emailService } from '@/server/services/email';
import { subscriptionService } from '@/server/services/subscriptions';
import { logger } from '@/server/lib/logger';

const log = logger.child({ module: 'auth' });

// In dev, allow access from any device on the local network (e.g. phone testing)
// across the RFC1918 private ranges. Production stays restricted to baseURL.
const devLanOrigins =
    process.env.NODE_ENV === 'development'
        ? ['http://192.168.*:3000', 'http://10.*:3000', 'http://172.*:3000']
        : [];

// better-auth enables rate limiting in production by default. The e2e suite
// runs against a production build and signs in many times concurrently, which
// trips the limiter ("Too many requests"). Disable it only under the E2E flag;
// real production keeps the default limiter.
const rateLimit = process.env.E2E ? { enabled: false } : undefined;

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
    }),
    trustedOrigins: devLanOrigins,
    rateLimit,
    emailAndPassword: {
        enabled: true,
        resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_SECONDS,
        // A reset is the recovery path for an account that may be compromised,
        // so every session created with the old password dies with it.
        revokeSessionsOnPasswordReset: true,
        // better-auth's own `url` points at its API, which only redirects to a
        // real page when the request carried a `redirectTo`. Link straight at
        // our page instead — same shape as the invite email.
        sendResetPassword: async ({ user, token }) => {
            await emailService.sendPasswordResetEmail({
                to: user.email,
                resetUrl: `${env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`,
                expiresAt: new Date(
                    Date.now() + RESET_PASSWORD_TOKEN_TTL_SECONDS * 1000
                ),
            });
        },
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // Update session every 24 hours
    },
    user: {
        additionalFields: {
            role: {
                type: 'string',
                input: false,
            },
        },
    },
    databaseHooks: {
        user: {
            create: {
                // Rethrow on failure: a half-provisioned account (user row
                // without a subscription row) is worse than a loud signup
                // failure. The user row may persist as an orphan if the hook
                // throws — the `backfill-trial-subscriptions` script
                // recovers those by inserting the missing subscription.
                // (Sponsored-path failures never reach here: the service
                // falls back to a trial internally; only trial-provisioning
                // failure rethrows.)
                after: async (user, context) => {
                    // Sent in the signup body by the /invite/[token]
                    // redemption page (#246); absent for normal signups.
                    // better-auth's sign-up body schema passes unknown keys
                    // through to this endpoint context, and its user-input
                    // parser drops them, so the token never touches the
                    // user row.
                    const bodyToken: unknown = context?.body?.inviteToken;
                    const inviteToken =
                        typeof bodyToken === 'string' && bodyToken !== ''
                            ? bodyToken
                            : null;
                    try {
                        await subscriptionService.provisionSignupSubscription(
                            db,
                            {
                                id: user.id,
                                email: user.email,
                                name: user.name,
                            },
                            inviteToken
                        );
                    } catch (err) {
                        log.error(
                            { err, userId: user.id },
                            'Failed to provision subscription on signup'
                        );
                        throw err;
                    }
                },
            },
        },
    },
});
