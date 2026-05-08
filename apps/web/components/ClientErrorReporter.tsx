'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { useSession } from '@/lib/auth/client';
import { log, setClientLogContext } from '@/lib/logger/client';

export function ClientErrorReporter(): null {
    const { data: session } = useSession();
    const pathname = usePathname();
    const userId = session?.user?.id;

    // Update during render (not in useEffect) so an error thrown by a
    // sibling's first render — the case error.tsx is here to handle — still
    // transmits with the right userId/page bindings. Guard for SSR: this
    // file is also rendered on the server for initial HTML, and the
    // singleton in `lib/logger/client` is shared across concurrent
    // requests in the same Node process — mutating it server-side would
    // leak the most recent request's user across requests if anything
    // ever reads `context` on the server.
    if (typeof window !== 'undefined') {
        setClientLogContext({ userId, page: pathname });
    }

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
