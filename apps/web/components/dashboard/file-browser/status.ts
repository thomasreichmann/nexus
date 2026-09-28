import {
    FileArchive,
    FileAudio,
    FileCode,
    FileIcon,
    FileImage,
    FileText,
    FileVideo,
} from 'lucide-react';
import { formatDownloadWindow } from '@/lib/format';
import type {
    ActiveRetrievalSummary,
    File,
    FileWithRetrieval,
} from '@nexus/db/repo/files';
import type { ActiveRetrievalWithFile } from '@nexus/db/repo/retrievals';

export type DerivedStatus = 'archived' | 'retrieving' | 'available';

/**
 * The one spelling of each derived status a user sees (#358, #413). Every
 * surface renders a file's status through this map, so the dashboard and the
 * file browser can't drift into separate vocabularies again.
 *
 * `available` reads "Ready to download", never "Available": the DB's own
 * `files.status = 'available'` means "archived, not downloadable", so the bare
 * word named opposite states one click apart.
 */
export const STATUS_LABELS: Record<DerivedStatus, string> = {
    archived: 'Archived',
    retrieving: 'Retrieving',
    available: 'Ready to download',
};

// Keep in lockstep with countStatusesByUser in
// packages/db/src/repositories/files.ts — the library-wide stats bar bucket
// counts must match the per-row status dots derived here.
export function deriveStatus(file: FileWithRetrieval): DerivedStatus {
    // The active retrieval wins, uniformly across tiers (#259): a ready row
    // is downloadable within its window, a queued/restoring row is in flight.
    //
    // Without one the file reads as archived. That is a deliberate floor, not
    // a claim: since #416 `getDownloadUrl` gates on a live HeadObject, so a
    // warm object *would* download with no retrieval row at all — but only S3
    // can say which objects those are, and this runs per row in the browser
    // with nothing but `files`. Offering Download on the strength of
    // `isProbablyCold` would promise a download we can't keep.
    if (file.activeRetrieval) {
        return file.activeRetrieval.status === 'ready'
            ? 'available'
            : 'retrieving';
    }
    if (file.status === 'restoring') return 'retrieving';
    return 'archived';
}

/**
 * Pair plain file rows with the user's active retrievals, for a surface that
 * loads the two separately — the dashboard preview reads `files.list` and the
 * polled `retrievals.listActive`. Both retrieval sources filter on
 * `activeRetrievalFilter`, so this yields the same `activeRetrieval` the file
 * browser's join does, and it stays live while the retrieval list polls.
 *
 * If a race ever left two active rows for one file (#266), the first in list
 * order wins — one row per file, like the join's dedupe, though not
 * necessarily the same row.
 */
export function attachActiveRetrievals(
    files: File[],
    retrievals: Pick<
        ActiveRetrievalWithFile,
        'fileId' | 'status' | 'expiresAt'
    >[]
): FileWithRetrieval[] {
    const byFileId = new Map<string, ActiveRetrievalSummary>();
    for (const { fileId, status, expiresAt } of retrievals) {
        if (!byFileId.has(fileId)) byFileId.set(fileId, { status, expiresAt });
    }
    return files.map((file) => ({
        ...file,
        activeRetrieval: byFileId.get(file.id) ?? null,
    }));
}

export function getDownloadWindowLabel(file: FileWithRetrieval): string | null {
    const retrieval = file.activeRetrieval;
    if (!retrieval) return null;
    return formatDownloadWindow(retrieval.status, retrieval.expiresAt);
}

export function getFileExtension(name: string): string {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export function getFileTypeInfo(name: string): {
    icon: typeof FileIcon;
    colorClass: string;
} {
    const ext = getFileExtension(name);

    const imageExts = [
        'jpg',
        'jpeg',
        'png',
        'gif',
        'svg',
        'webp',
        'bmp',
        'ico',
    ];
    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'];
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
    const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'];
    const codeExts = [
        'js',
        'ts',
        'tsx',
        'jsx',
        'py',
        'rb',
        'go',
        'rs',
        'java',
        'c',
        'cpp',
        'h',
        'css',
        'html',
        'json',
        'yaml',
        'yml',
        'xml',
        'sql',
        'sh',
    ];
    const docExts = [
        'pdf',
        'doc',
        'docx',
        'txt',
        'md',
        'rtf',
        'xls',
        'xlsx',
        'csv',
        'ppt',
        'pptx',
    ];

    if (imageExts.includes(ext))
        return { icon: FileImage, colorClass: 'text-rose-500 bg-rose-500/10' };
    if (videoExts.includes(ext))
        return {
            icon: FileVideo,
            colorClass: 'text-purple-500 bg-purple-500/10',
        };
    if (audioExts.includes(ext))
        return {
            icon: FileAudio,
            colorClass: 'text-amber-500 bg-amber-500/10',
        };
    if (archiveExts.includes(ext))
        return {
            icon: FileArchive,
            colorClass: 'text-orange-500 bg-orange-500/10',
        };
    if (codeExts.includes(ext))
        return {
            icon: FileCode,
            colorClass: 'text-emerald-500 bg-emerald-500/10',
        };
    if (docExts.includes(ext))
        return { icon: FileText, colorClass: 'text-blue-500 bg-blue-500/10' };
    return { icon: FileIcon, colorClass: 'text-muted-foreground bg-muted' };
}
