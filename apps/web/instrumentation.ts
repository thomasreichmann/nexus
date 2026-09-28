import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('./sentry.server.config');

        // Deployed envs only (#409). Local dev, CI and the e2e build (which
        // sets a synthetic bucket) have no VERCEL_ENV, and the build phase
        // must not reach for AWS. The check never throws and caps its own
        // wait, so awaiting it can't block boot for long.
        if (
            process.env.VERCEL_ENV &&
            process.env.NEXT_PHASE !== 'phase-production-build'
        ) {
            try {
                const { runDerivedBucketCheck } =
                    await import('./server/lib/derivedBucketCheck');
                await runDerivedBucketCheck();
            } catch (err) {
                console.error('Derived bucket check failed to load', err);
            }
        }
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
