'use client';

import { log } from '@/lib/logger/client';
import { useEffect, useRef } from 'react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    // Dedupe against React.StrictMode's dev-mode double-invocation of
    // effects: without this, a single boundary error writes two `.dev.log`
    // entries.
    const logged = useRef(new Set<string | Error>());
    useEffect(() => {
        const key = error.digest ?? error;
        if (logged.current.has(key)) return;
        logged.current.add(key);
        log.error(
            { err: error, digest: error.digest },
            error.message || 'global error boundary'
        );
    }, [error]);

    return (
        <html lang="en">
            <body>
                <div
                    style={{
                        display: 'flex',
                        minHeight: '100vh',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'system-ui, sans-serif',
                        padding: '1rem',
                    }}
                >
                    <div
                        style={{
                            maxWidth: '28rem',
                            width: '100%',
                            textAlign: 'center',
                        }}
                    >
                        <h1
                            style={{
                                fontSize: '1.25rem',
                                fontWeight: 600,
                                marginBottom: '0.5rem',
                            }}
                        >
                            Something went wrong
                        </h1>
                        <p
                            style={{
                                color: '#6b7280',
                                fontSize: '0.875rem',
                                marginBottom: '1.5rem',
                            }}
                        >
                            A critical error occurred. Please try again.
                        </p>
                        <button
                            onClick={reset}
                            style={{
                                padding: '0.5rem 1rem',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                backgroundColor: '#18181b',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '0.375rem',
                                cursor: 'pointer',
                            }}
                        >
                            Try again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
