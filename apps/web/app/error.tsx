'use client';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { log } from '@/lib/logger/client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

export default function Error({
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
            error.message || 'route error boundary'
        );
    }, [error]);

    return (
        <div className="flex min-h-[50vh] items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Something went wrong</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">
                        An unexpected error occurred. Please try again or return
                        to the home page.
                    </p>
                </CardContent>
                <CardFooter className="gap-2">
                    <Button onClick={reset}>Try again</Button>
                    <Button variant="outline" render={<Link href="/" />}>
                        Home
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
