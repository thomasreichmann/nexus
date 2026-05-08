'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { useSession } from '@/lib/auth/client';
import { log, setClientLogContext } from '@/lib/logger/client';

export function ClientErrorReporter(): null {
    const { data: session } = useSession();
    const pathname = usePathname();
    const userId = session?.user?.id;

    useEffect(() => {
        setClientLogContext({ userId, page: pathname });
    }, [userId, pathname]);

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
            const message =
                reason instanceof Error
                    ? reason.message
                    : typeof reason === 'string'
                      ? reason
                      : 'unhandled promise rejection';
            log.error(
                { err: reason instanceof Error ? reason : undefined, reason },
                message
            );
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
