'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useUploadWave } from './useUpload';

const UPLOAD_PAGE = '/dashboard/upload';

/**
 * The running upload wave, on every dashboard page (#399). A wave outlives the
 * upload page now, so this is how it stays in sight while the user browses,
 * and the way back to its queue. Not on the upload page itself, whose own
 * header already shows the wave.
 *
 * It also holds the one guard a wave still needs: closing or reloading the tab
 * does end it, so the browser asks first. In-app navigation no longer can, so
 * it no longer asks (#398's link interceptor is gone).
 */
export function UploadWaveIndicator() {
    const pathname = usePathname();
    const wave = useUploadWave();

    useEffect(() => {
        if (!wave.isActive) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            // preventDefault is what modern Chromium honors; returnValue is
            // the legacy channel other engines still need for the prompt.
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [wave.isActive]);

    // Trailing slash off: the app serves `/dashboard/upload/` as is.
    const isOnUploadPage = pathname.replace(/\/$/, '') === UPLOAD_PAGE;
    if (!wave.isActive || isOnUploadPage) return null;

    const failed = wave.errorCount > 0 ? `, ${wave.errorCount} failed` : '';
    return (
        <Link
            href={UPLOAD_PAGE}
            aria-label={`Uploading ${wave.completedCount} of ${wave.fileCount} files, ${wave.percent}%${failed}`}
            className="relative flex h-8 items-center gap-2 overflow-hidden rounded-full border border-border bg-muted/40 px-3 text-xs font-medium transition-colors hover:bg-muted"
        >
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            <span className="tabular-nums">
                <span className="hidden sm:inline">Uploading </span>
                {wave.completedCount}
                <span className="hidden sm:inline"> of </span>
                <span className="sm:hidden">/</span>
                {wave.fileCount}
            </span>
            <span className="text-muted-foreground tabular-nums">
                {wave.percent}%
            </span>
            {wave.errorCount > 0 && (
                <span className="hidden text-destructive sm:inline">
                    {wave.errorCount} failed
                </span>
            )}
            {/* The wave's byte-weighted progress, along the pill's floor. */}
            <span
                aria-hidden
                className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width]"
                style={{ width: `${wave.percent}%` }}
            />
        </Link>
    );
}
