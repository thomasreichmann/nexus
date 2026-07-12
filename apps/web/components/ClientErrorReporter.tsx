'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';

import { useSession } from '@/lib/auth/client';
import { log, setClientLogContext } from '@/lib/logger/client';

export function ClientErrorReporter(): null {
    const { data: session } = useSession();
    const pathname = usePathname();
    const userId = session?.user?.id;

    // Set during render so first-render errors still transmit with
    // bindings — useEffect would fire too late. SSR-guarded because the
    // singleton is shared across concurrent server requests in the same
    // Node process.
    if (typeof window !== 'undefined') {
        setClientLogContext({ userId, page: pathname });
        // Attach the signed-in user to client-side Sentry events (the URL is
        // already on every event). `null` clears it on sign-out.
        Sentry.setUser(userId ? { id: userId } : null);
    }

    // These listeners feed the pino dev-log transmit only. Sentry installs
    // its own window error/unhandledrejection instrumentation at init —
    // capturing here as well would double-report every uncaught error.
    useEffect(() => {
        function handleError(event: ErrorEvent): void {
            log.error(
                {
                    err: event.error,
                    source: event.filename,
                    line: event.lineno,
                    col: event.colno,
                },
                event.message || 'uncaught error'
            );
        }

        function handleRejection(event: PromiseRejectionEvent): void {
            const reason = event.reason;
            if (reason instanceof Error) {
                log.error(
                    { err: reason },
                    reason.message || 'unhandled promise rejection'
                );
                return;
            }
            const message =
                typeof reason === 'string'
                    ? reason
                    : 'unhandled promise rejection';
            log.error({ reason }, message);
        }

        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);

        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, []);

    return null;
}
