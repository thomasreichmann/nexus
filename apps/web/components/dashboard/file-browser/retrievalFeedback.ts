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

    // Stable ids so repeated attempts against a broken S3 collapse into one
    // toast, matching the errorLink's dedup behavior.
    if (failedCount === total) {
        toast.error(
            failedCount === 1
                ? 'Retrieval could not be started'
                : `None of the ${failedCount} retrievals could be started`,
            { id: 'retrieval-request-failed' }
        );
        return;
    }

    // Counted as failures against the total requested: `started` includes
    // rows that already existed before this call, so a started-count would
    // claim restores this call never launched.
    toast.warning(
        `${failedCount} of ${total} retrievals could not be started`,
        { id: 'retrieval-request-partial' }
    );
}
