import { FilesLibrary } from '@/components/dashboard/files-library/FilesLibrary';
import { RetrievalDownloads } from '@/components/dashboard/RetrievalDownloads';

interface FilesPageProps {
    searchParams: Promise<{ request?: string }>;
}

// Two deep-link targets, both landed on from a retrieval-ready email:
// `?file={id}` opens the file's batch and highlights it (the single-file
// restore, #437; FilesLibrary reads it client-side, alongside `?batch=`),
// while `?request={id}` opens the zip parts of a multi-file restore above the
// browser (#426). Both ride proxy.ts's redirect preservation, so a signed-out
// reader arrives here after authenticating.
export default async function FilesPage({ searchParams }: FilesPageProps) {
    const { request } = await searchParams;

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            {request && <RetrievalDownloads requestId={request} />}
            <FilesLibrary />
        </div>
    );
}
