'use client';

import { AlertTriangle } from 'lucide-react';
import type { TRPCClientErrorLike } from '@trpc/client';

import { cn } from '@/lib/cn';
import { useDomainError } from '@/lib/trpc/useDomainError';
import type { AppRouter } from '@/server/trpc/router';

interface TrialExpiredBannerProps {
    error: TRPCClientErrorLike<AppRouter> | null | undefined;
    className?: string;
}

/**
 * Renders a warning banner when the tRPC error carries `TRIAL_EXPIRED`. Null
 * otherwise. First end-to-end consumer of the `DomainErrorCode` contract —
 * server-side enforcement lives in #199.
 */
export function TrialExpiredBanner({
    error,
    className,
}: TrialExpiredBannerProps) {
    const domainError = useDomainError(error);
    if (domainError?.code !== 'TRIAL_EXPIRED') return null;

    return (
        <div
            role="alert"
            className={cn(
                'flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100',
                className
            )}
        >
            <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-amber-400"
            />
            <div className="space-y-0.5">
                <p className="font-medium">Your trial has expired</p>
                <p className="text-amber-200/80">{domainError.message}</p>
            </div>
        </div>
    );
}
