import { FileBrowser } from '@/components/dashboard/file-browser';
import { DepthMarker } from '@/components/landing/depth-marker';

export default function FilesPage() {
    return (
        <div className="mx-auto max-w-6xl space-y-8">
            <div>
                <DepthMarker depth="−4,000 m" name="Vault manifest" />
                <h1 className="mt-4 font-display text-4xl tracking-tight text-(--foam)">
                    Files in the deep.
                </h1>
                <p className="mt-2 text-sm text-(--faint)">
                    Everything you&apos;ve sent down, and where it sits.
                </p>
            </div>
            <FileBrowser />
        </div>
    );
}
