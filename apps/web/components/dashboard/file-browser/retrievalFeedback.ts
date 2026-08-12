import { toast } from 'sonner';

// A retrieval request writes a row per file and then asks S3 to restore each
// one, so a single call can come back partly failed (#329) — the service
// returns the started/failed split directly. Shared by the single-file,
// bulk, and batch mutations so all three read the same result. Error copy is
// the errorLink's job; call sites pass `toastContext({ errorMessage })`
// instead of handling errors here.

interface RetrievalRequestCounts {
    started: readonly unknown[];
    failed: readonly unknown[];
}

export function toastRetrievalResult(
    result: RetrievalRequestCounts,
    successMessage: string
): void {
    const failedCount = result.failed.length;
    const total = result.started.length + failedCount;

    if (failedCount === 0) {
        toast.success(successMessage);
        return;
    }

    if (failedCount === total) {
        toast.error(
            failedCount === 1
                ? 'Retrieval could not be started'
                : `None of the ${failedCount} retrievals could be started`
        );
        return;
    }

    toast.warning(
        `Started ${total - failedCount} of ${total} retrievals; ${failedCount} could not be started`
    );
}
