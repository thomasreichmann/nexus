import { ShareUploader } from '@/components/share/ShareUploader';
import { formatBytes } from '@/lib/format';
import { MAX_SHARE_BYTES } from '@/lib/share/limits';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Share files - Nexus',
    description:
        'Upload files and get a link to send. No account needed. Links last 24 hours.',
};

export default function SharePage() {
    return (
        <>
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">Share files</h1>
                <p className="text-muted-foreground">
                    Upload up to {formatBytes(MAX_SHARE_BYTES)} and get a link
                    to send. No account needed. The link works for 24 hours.
                </p>
            </div>
            <ShareUploader />
        </>
    );
}
