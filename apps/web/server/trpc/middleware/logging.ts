import { logger } from '@/server/lib/logger';

export interface RequestLogger {
    setField: (key: string, value: unknown) => void;
    timed: <T>(label: string, fn: () => T | Promise<T>) => Promise<T>;
    time: (label: string) => void;
    timeEnd: (label: string) => void;
}

export interface LoggingContext {
    requestId: string;
    log: RequestLogger;
}

interface WideEvent {
    requestId: string;
    path: string;
    type: 'query' | 'mutation' | 'subscription';
    userId?: string;
    durationMs: number;
    timings?: Record<string, number>;
    ok: boolean;
    errorCode?: string;
    [key: string]: unknown;
}

function createRequestLogger(): {
    logger: RequestLogger;
    getTimings: () => Record<string, number>;
    getCustomFields: () => Record<string, unknown>;
    finalize: (requestId: string) => void;
} {
    const customFields: Record<string, unknown> = {};
    const timings: Record<string, number> = {};
    const activeTimers: Map<string, number> = new Map();
    const isDev = process.env.NODE_ENV === 'development';

    return {
        logger: {
            setField(key: string, value: unknown) {
                customFields[key] = value;
            },

            async timed<T>(
                label: string,
                fn: () => T | Promise<T>
            ): Promise<T> {
                const timerStart = performance.now();
                try {
                    return await fn();
                } finally {
                    timings[label] = Math.round(performance.now() - timerStart);
                }
            },

            time(label: string) {
                activeTimers.set(label, performance.now());
            },

            timeEnd(label: string) {
                const timerStart = activeTimers.get(label);
                if (timerStart !== undefined) {
                    timings[label] = Math.round(performance.now() - timerStart);
                    activeTimers.delete(label);
                }
            },
        },
        getTimings: () => timings,
        getCustomFields: () => customFields,
        finalize(requestId: string) {
            // Auto-end any unterminated timers with warning in dev
            for (const [label, timerStart] of activeTimers.entries()) {
                timings[label] = Math.round(performance.now() - timerStart);
                if (isDev) {
                    logger.warn(
                        { requestId, label },
                        `Timer "${label}" was not ended before procedure completed`
                    );
                }
            }
        },
    };
}

export function logRequest<
    TContext extends { session?: { user?: { id?: string } } | null },
>(opts: {
    ctx: TContext;
    path: string;
    type: 'query' | 'mutation' | 'subscription';
}): {
    requestId: string;
    log: RequestLogger;
    emitEvent: (ok: boolean, errorCode?: string) => void;
} {
    const { ctx, path, type } = opts;
    const requestId = crypto.randomUUID();
    const startTime = performance.now();
    const {
        logger: log,
        getTimings,
        getCustomFields,
        finalize,
    } = createRequestLogger();

    return {
        requestId,
        log,
        emitEvent(ok: boolean, errorCode?: string) {
            finalize(requestId);

            const durationMs = Math.round(performance.now() - startTime);
            const userId = ctx.session?.user?.id;
            const timings = getTimings();
            const customFields = getCustomFields();

            const event: WideEvent = {
                requestId,
                path,
                type,
                durationMs,
                ok,
                ...customFields,
            };

            if (userId) {
                event.userId = userId;
            }

            if (Object.keys(timings).length > 0) {
                event.timings = timings;
            }

            if (errorCode) {
                event.errorCode = errorCode;
            }

            if (ok) {
                logger.info(event, `${type} ${path}`);
            } else {
                logger.error(event, `${type} ${path} failed`);
            }
        },
    };
}
