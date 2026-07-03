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
import type { FileWithRetrieval } from '@nexus/db/repo/files';

export type DerivedStatus = 'archived' | 'retrieving' | 'available';

// Keep in lockstep with countStatusesByUser in
// packages/db/src/repositories/files.ts — the library-wide stats bar bucket
// counts must match the per-row status dots derived here.
export function deriveStatus(file: FileWithRetrieval): DerivedStatus {
    // The active retrieval wins, uniformly across tiers (#259): a ready row
    // is downloadable within its window, a queued/restoring row is in
    // flight. Without one the file sits archived — never Download, since
    // getDownloadUrl can't serve without a ready retrieval (#256).
    if (file.activeRetrieval) {
        return file.activeRetrieval.status === 'ready'
            ? 'available'
            : 'retrieving';
    }
    if (file.status === 'restoring') return 'retrieving';
    return 'archived';
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
