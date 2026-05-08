import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '@nexus/db/schema';
import { db } from '@/server/db';
import { subscriptionService } from '@/server/services/subscriptions';
import { logger } from '@/server/lib/logger';

const log = logger.child({ module: 'auth' });

// In dev, allow access from any device on the local network (e.g. phone testing)
// across the RFC1918 private ranges. Production stays restricted to baseURL.
const devLanOrigins =
    process.env.NODE_ENV === 'development'
        ? ['http://192.168.*:3000', 'http://10.*:3000', 'http://172.*:3000']
        : [];

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
    }),
    trustedOrigins: devLanOrigins,
    emailAndPassword: {
        enabled: true,
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
                after: async (user) => {
                    try {
                        await subscriptionService.provisionTrialSubscription(
                            db,
                            user.id,
                            user.email,
                            user.name
                        );
                    } catch (err) {
                        log.error(
                            { err, userId: user.id },
                            'Failed to provision trial subscription on signup'
                        );
                    }
                },
            },
        },
    },
});
