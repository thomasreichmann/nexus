import Link from 'next/link';
import { formatDistance } from 'date-fns';
import { Clock, FileQuestion } from 'lucide-react';
import { SharedFileList } from '@/components/share/SharedFileList';
import { Button } from '@/components/ui/button';
import { countLabel, formatBytes } from '@/lib/format';
import { db } from '@/server/db';
import { shareService } from '@/server/services/shares';
import type { Metadata } from 'next';

// A link has to stop working the moment it expires, so never serve this from
// the route cache.
export const dynamic = 'force-dynamic';

// The URL is the credential. Keep it out of search indexes.
export const metadata: Metadata = {
    title: 'Shared files - Nexus',
    robots: { index: false, follow: false },
};

interface SharedFilesPageProps {
    params: Promise<{ id: string }>;
}

export default async function SharedFilesPage({
    params,
}: SharedFilesPageProps) {
    const { id } = await params;
    const now = new Date();
    const share = await shareService.getShare(db, id, now);

    if (!share) return <ShareUnavailable />;

    return (
        <>
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">
                    {countLabel(share.files.length, 'file')} shared with you
                </h1>
                <p className="flex items-center justify-center gap-1.5 text-muted-foreground">
                    <Clock className="size-4" />
                    {formatBytes(share.totalSize)} · expires in{' '}
                    {formatDistance(share.expiresAt, now)}
                </p>
            </div>
            <SharedFileList shareId={share.id} files={share.files} />
        </>
    );
}

/**
 * One message for every way a link can be dead. Telling an unknown id from an
 * expired one would let anyone probe which ids ever existed.
 */
function ShareUnavailable() {
    return (
        <div className="text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                <FileQuestion className="size-6 text-muted-foreground" />
            </div>
            <h1 className="mb-2 text-2xl font-bold">
                This link isn’t available
            </h1>
            <p className="mb-6 text-muted-foreground">
                Shared links stop working after 24 hours. Ask whoever sent it to
                share the files again.
            </p>
            <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/share" />}
            >
                Share your own files
            </Button>
        </div>
    );
}
