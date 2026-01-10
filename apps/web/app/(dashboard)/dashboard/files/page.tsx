import { FileBrowser } from '@/components/dashboard/file-browser';

export default function FilesPage() {
    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Files</h1>
                <p className="text-muted-foreground">
                    Browse and manage your archived files
                </p>
            </div>
            <FileBrowser />
        </div>
    );
}
