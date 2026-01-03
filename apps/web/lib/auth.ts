import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/server/db';
import * as schema from '@/server/db/schema';

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
    }),
    emailAndPassword: {
        enabled: true,
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // Update session every 24 hours
    },
});
