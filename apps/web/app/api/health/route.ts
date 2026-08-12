import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';

const log = logger.child({ handler: 'health' });

// Every request must actually probe the DB — never a build-time snapshot.
export const dynamic = 'force-dynamic';

/**
 * Unauthenticated liveness probe for the uptime workflow
 * (`.github/workflows/uptime.yml`, #333). Reports whether the app can reach
 * its database; response bodies stay generic so nothing about the failure
 * (connection strings, driver errors) leaks to the public internet.
 */
export async function GET(): Promise<NextResponse> {
    try {
        await db.execute(sql`select 1`);
        return NextResponse.json({ status: 'ok', checks: { db: 'ok' } });
    } catch (err) {
        // An unreachable DB is the expected failure this route exists to
        // surface: log + 503, no Sentry capture, no in-app alert — during a
        // real outage this route can't deliver either. The uptime workflow
        // owns notification.
        log.error({ err }, 'Health check failed');
        return NextResponse.json(
            { status: 'error', checks: { db: 'down' } },
            { status: 503 }
        );
    }
}
