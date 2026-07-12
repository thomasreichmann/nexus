import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('./sentry.server.config');
    }
    if (process.env.NEXT_RUNTIME === 'edge') {
        await import('./sentry.edge.config');
    }
}

// Captures errors from React Server Components and route handlers. tRPC
// procedure errors never surface here — the fetch adapter catches them —
// so those are reported from the logging middleware instead.
export const onRequestError = Sentry.captureRequestError;
