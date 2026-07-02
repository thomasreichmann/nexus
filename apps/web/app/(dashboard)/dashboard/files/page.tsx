import { FileBrowser } from '@/components/dashboard/file-browser';

interface FilesPageProps {
    searchParams: Promise<{ file?: string }>;
}

// `?file={id}` is the deep-link target used by the retrieval-ready email —
// FileBrowser scrolls to and highlights that file.
export default async function FilesPage({ searchParams }: FilesPageProps) {
    const { file } = await searchParams;

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Files</h1>
                <p className="text-sm text-muted-foreground">
                    Browse and manage your archived files
                </p>
            </div>
            <FileBrowser focusFileId={file} />
        </div>
    );
}
