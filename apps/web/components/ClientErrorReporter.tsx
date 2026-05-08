'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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
