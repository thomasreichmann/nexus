import { toast } from 'sonner';

// A retrieval request now answers with what it accepted, not with what S3 said
// (#423): the HEAD + RestoreObject fan-out runs as a worker job after the
// mutation returns, so there is no started/failed split left to report here.
// Per-file outcomes reach the user the same way a restore failing hours later
// already does — through the file list's status. Shared by the single-file,
// bulk, and batch mutations so all three say the same thing. Error copy is the
// errorLink's job; call sites pass `toastContext({ errorMessage })` instead of
// handling errors here.

export function toastRetrievalRequested(fileCount: number): void {
    toast.success(
        fileCount === 1
            ? 'Retrieval request submitted'
            : `Retrieval requested for ${fileCount} files`
    );
}
