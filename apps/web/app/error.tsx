'use client';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import Link from 'next/link';

export default function Error({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
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
