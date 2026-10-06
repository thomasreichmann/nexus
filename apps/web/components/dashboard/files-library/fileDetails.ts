import { getFileExtension } from '@/components/dashboard/file-browser/status';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

const KINDS: Record<string, string> = {
    jpg: 'JPEG image',
    jpeg: 'JPEG image',
    png: 'PNG image',
    gif: 'GIF image',
    webp: 'WebP image',
    avif: 'AVIF image',
    heic: 'HEIC image',
    heif: 'HEIF image',
    tif: 'TIFF image',
    tiff: 'TIFF image',
    cr2: 'Canon RAW',
    cr3: 'Canon RAW',
    nef: 'Nikon RAW',
    arw: 'Sony RAW',
    raf: 'Fujifilm RAW',
    orf: 'Olympus RAW',
    rw2: 'Panasonic RAW',
    dng: 'DNG RAW',
    mp4: 'MP4 video',
    mov: 'QuickTime video',
    m4v: 'MP4 video',
    webm: 'WebM video',
    pdf: 'PDF document',
    zip: 'ZIP archive',
};

/** "Canon RAW", "JPEG image", or the bare extension for anything else. */
export function describeKind(name: string): string {
    const ext = getFileExtension(name);
    return KINDS[ext] ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}

// What a browser can show from the original bytes once they're restored.
// RAW, HEIC and TIFF are left out: they download fine but don't render.
const VIEWABLE_IMAGES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
const PLAYABLE_VIDEOS = new Set(['mp4', 'm4v', 'webm', 'mov']);

export type OriginalKind = 'image' | 'video';

export function getOriginalKind(name: string): OriginalKind | null {
    const ext = getFileExtension(name);
    if (VIEWABLE_IMAGES.has(ext)) return 'image';
    if (PLAYABLE_VIDEOS.has(ext)) return 'video';
    return null;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase();

/**
 * The other files of the same shot: a camera shooting RAW+JPEG writes
 * `DSC_0001.NEF` and `DSC_0001.JPG` side by side, and a photographer thinks
 * of them as one photo in two formats.
 */
export function findCompanions(
    files: FileWithRetrieval[],
    file: FileWithRetrieval
): FileWithRetrieval[] {
    const own = stem(file.name);
    return files.filter((f) => f.id !== file.id && stem(f.name) === own);
}
