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
    // transmits with the right userId/page bindings. The setter is
    // idempotent, so StrictMode double-renders are harmless.
    setClientLogContext({ userId, page: pathname });

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
