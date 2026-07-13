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
// errors never surface here — the fetch adapter catches them — so those are
// reported from the logging middleware (procedure errors) and the adapter's
// onError in app/api/trpc/[trpc]/route.ts (context-creation failures).
export const onRequestError = Sentry.captureRequestError;
