import {
    errorVerbosity,
    isDev,
    logger,
    transformStackTrace,
} from '@/server/lib/logger';
import type { TRPCError } from '@trpc/server';

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

export interface FormattedError {
    code: string;
    message?: string;
    stack?: string;
    cause?: FormattedError;
}

interface WideEvent {
    requestId: string;
    path: string;
    type: 'query' | 'mutation' | 'subscription';
    userId?: string;
    durationMs: number;
    timings?: Record<string, number>;
    ok: boolean;
    error?: FormattedError;
    [key: string]: unknown;
}

const MAX_CAUSE_DEPTH = 5;

function formatErrorCause(
    error: Error,
    depth: number
): FormattedError | undefined {
    if (depth >= MAX_CAUSE_DEPTH) return undefined;

    const cause = error.cause;
    if (!(cause instanceof Error)) return undefined;

    const formatted: FormattedError = { code: cause.name };

    if (errorVerbosity !== 'minimal') {
        formatted.message = cause.message;
    }

    if (errorVerbosity === 'full') {
        formatted.stack = transformStackTrace(cause.stack);
        formatted.cause = formatErrorCause(cause, depth + 1);
    }

    return formatted;
}

export function formatError(error: TRPCError): FormattedError {
    const formatted: FormattedError = { code: error.code };

    if (errorVerbosity !== 'minimal') {
        formatted.message = error.message;
    }

    if (errorVerbosity === 'full') {
        formatted.stack = transformStackTrace(error.stack);
        formatted.cause = formatErrorCause(error, 0);
    }

    return formatted;
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
    emitEvent: (ok: boolean, error?: TRPCError) => void;
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
        emitEvent(ok: boolean, error?: TRPCError) {
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

            if (error) {
                event.error = formatError(error);
            }

            if (ok) {
                logger.info(event, `${type} ${path}`);
            } else {
                logger.error(event, `${type} ${path} failed`);
            }
        },
    };
}
