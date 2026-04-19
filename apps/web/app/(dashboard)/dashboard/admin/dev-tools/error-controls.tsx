'use client';

import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { TrialExpiredBanner } from '@/components/trial-expired-banner';
import { useTRPC } from '@/lib/trpc/client';

export function ErrorControls() {
    const trpc = useTRPC();
    const trialExpired = useMutation(
        trpc.admin.devTools.throwTrialExpired.mutationOptions({
            trpc: { context: { skipToast: true } },
        })
    );

    return (
        <Card className="border-border/50 bg-zinc-900/60">
            <div className="border-b border-border/30 px-3 py-2">
                <h2 className="font-mono text-xs text-amber-400/80">
                    {'>'} domain errors
                </h2>
            </div>
            <CardContent className="space-y-2.5 p-3">
                <button
                    type="button"
                    onClick={() => trialExpired.mutate()}
                    disabled={trialExpired.isPending}
                    className="h-8 w-full cursor-pointer rounded-md border border-border bg-background px-3 font-mono text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                    <AlertTriangle
                        aria-hidden="true"
                        className="mr-1 inline size-3.5"
                    />
                    Throw TrialExpiredError
                </button>
                <TrialExpiredBanner error={trialExpired.error} />
            </CardContent>
        </Card>
    );
}
