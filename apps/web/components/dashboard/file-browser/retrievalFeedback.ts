import { toast } from 'sonner';
import { getDomainError } from '@/lib/trpc/get-domain-error';
import type { TRPCClientErrorLike } from '@trpc/client';
import type { AppRouter } from '@/server/trpc/router';

// A retrieval request writes a row per file and then asks S3 to restore each
// one, so a single call can come back partly failed (#329). Shared by the
// single-file, bulk, and batch mutations so all three read the same result.

interface RetrievalOutcome {
    status: string;
}

export function toastRetrievalResult(
    retrievals: RetrievalOutcome[],
    successMessage: string
): void {
    const failedCount = retrievals.filter((r) => r.status === 'failed').length;

    if (failedCount === 0) {
        toast.success(successMessage);
        return;
    }

    if (failedCount === retrievals.length) {
        toast.error(
            failedCount === 1
                ? 'Retrieval could not be started'
                : `None of the ${failedCount} retrievals could be started`
        );
        return;
    }

    toast.warning(
        `Started ${retrievals.length - failedCount} of ${retrievals.length} retrievals; ${failedCount} could not be started`
    );
}

export function toastRetrievalError(
    error: TRPCClientErrorLike<AppRouter>,
    fallbackMessage: string
): void {
    const domain = getDomainError(error);
    switch (domain?.code) {
        case 'NOT_FOUND':
            toast.error('That file is no longer available');
            return;
        case 'INVALID_STATE':
            // The service's message names the blocking state (wrong file
            // status, empty batch) and is safe to show.
            toast.error(domain.message);
            return;
        default:
            toast.error(fallbackMessage);
    }
}
