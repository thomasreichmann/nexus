import * as Sentry from '@sentry/nextjs';

import { errorVerbosity, isDev, logger } from '@/server/lib/logger';
import { isDomainError } from '@/server/errors';
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

interface ZodLikeIssue {
    path: PropertyKey[];
    message: string;
}

/** Duck-type check for ZodError (avoids cross-module instanceof issues). */
export function isZodError(
    error: unknown
): error is Error & { issues: ZodLikeIssue[] } {
    return (
        error instanceof Error &&
        'issues' in error &&
        Array.isArray((error as { issues: unknown }).issues)
    );
}

/** Format ZodError issues into a compact summary message. */
export function formatZodMessage(issues: ZodLikeIssue[]): string {
    const lines = issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  - ${path}: ${issue.message}`;
    });
    return `Zod validation failed (${issues.length} issue${issues.length !== 1 ? 's' : ''})\n${lines.join('\n')}`;
}

/** Strip code frames from a stack trace, keeping only the first line and `at ...` lines. */
export function trimStackTrace(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    const lines = stack.split('\n');
    return lines.filter((line) => /^\S|^\s+at /.test(line)).join('\n');
}

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
        formatted.stack = cause.stack;
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
        if (isZodError(error.cause)) {
            // ZodError: compact issues inline, suppress redundant cause
            formatted.message = formatZodMessage(error.cause.issues);
            // Input validation (BAD_REQUEST): stack adds no value — the
            // procedure path is already in the log line. Internal validation
            // (any other code): keep a trimmed stack for debugging.
            if (error.code !== 'BAD_REQUEST') {
                formatted.stack = trimStackTrace(error.stack);
            }
        } else {
            formatted.stack = error.stack;
            formatted.cause = formatErrorCause(error, 0);
        }
    }

    return formatted;
}

/**
 * Expected failures are product behavior, not defects: domain errors (typed
 * 4xx-class outcomes), Zod input validation, and bare auth-gate rejections
 * (UNAUTHORIZED/FORBIDDEN thrown by protectedProcedure/adminProcedure with no
 * cause — e.g. an expired session hitting a protected endpoint). Everything
 * else is a bug Sentry should own. Mirrored client-side in
 * lib/trpc/error-reporting.ts against the serialized error shape.
 */
export function isUnexpectedTrpcError(error: TRPCError): boolean {
    if (isDomainError(error.cause)) return false;
    if (isZodError(error.cause)) return false;
    if (
        (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') &&
        error.cause === undefined
    ) {
        return false;
    }
    return true;
}

/**
 * Send an unexpected failure to Sentry with the wide event's correlation ids.
 * Captures `cause` when present — that's the original throw with the real
 * stack; the TRPCError is just the transport wrapper.
 */
function reportUnexpectedError(error: TRPCError, event: WideEvent): void {
    if (!isUnexpectedTrpcError(error)) return;

    Sentry.captureException(error.cause ?? error, {
        tags: {
            requestId: event.requestId,
            path: event.path,
            ...(event.userId ? { userId: event.userId } : {}),
        },
        contexts: {
            trpc: {
                type: event.type,
                durationMs: event.durationMs,
                code: error.code,
            },
        },
    });
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
                reportUnexpectedError(error, event);
            }

            if (ok) {
                logger.info(event, `${type} ${path}`);
            } else {
                logger.error(event, `${type} ${path} failed`);
            }
        },
    };
}
