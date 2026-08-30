import { FileBrowser } from '@/components/dashboard/file-browser';
import { RetrievalDownloads } from '@/components/dashboard/RetrievalDownloads';

interface FilesPageProps {
    searchParams: Promise<{ file?: string; request?: string }>;
}

// Two deep-link targets, both landed on from a retrieval-ready email:
// `?file={id}` scrolls to and highlights one file (the single-file restore,
// #437), while `?request={id}` opens the zip parts of a multi-file restore
// above the browser (#426). Both ride proxy.ts's redirect preservation, so a
// signed-out reader arrives here after authenticating.
export default async function FilesPage({ searchParams }: FilesPageProps) {
    const { file, request } = await searchParams;

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Files</h1>
                <p className="text-sm text-muted-foreground">
                    Browse and manage your archived files
                </p>
            </div>
            {request && <RetrievalDownloads requestId={request} />}
            <FileBrowser focusFileId={file} />
        </div>
    );
}
