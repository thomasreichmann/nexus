import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/server/lib/logger';
import type { Level, LogEvent } from 'pino';

const clientLogger = logger.child({ source: 'client' });

const levelToMethod: Record<number, Level> = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
};

function logWithLevel(
    level: Level,
    bindings: Record<string, unknown>,
    messages: unknown[]
): void {
    const [first, ...rest] = messages;

    if (typeof first === 'object' && first !== null) {
        const mergedObj = {
            ...bindings,
            ...(first as Record<string, unknown>),
        };
        const [msg, ...interpolations] = rest;
        if (typeof msg === 'string') {
            clientLogger[level](mergedObj, msg, ...interpolations);
        } else {
            clientLogger[level](mergedObj);
        }
    } else if (typeof first === 'string') {
        clientLogger[level](bindings, first, ...rest);
    } else if (first !== undefined) {
        clientLogger[level](bindings, String(first), ...rest);
    } else {
        clientLogger[level](bindings);
    }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    // Only available in development
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
        const logEvent = (await request.json()) as LogEvent;

        const level = levelToMethod[logEvent.level.value] ?? 'info';
        const bindings = logEvent.bindings.reduce<Record<string, unknown>>(
            (acc, b) => ({ ...acc, ...b }),
            {}
        );

        logWithLevel(level, bindings, logEvent.messages);

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json(
            { error: 'Invalid log event' },
            { status: 400 }
        );
    }
}
