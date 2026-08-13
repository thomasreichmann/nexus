import type { File } from './repositories/files';

const RAW_EXTENSIONS = new Set([
    'arw',
    'cr2',
    'cr3',
    'dng',
    'nef',
    'nrw',
    'orf',
    'pef',
    'raf',
    'rw2',
    'sr2',
    'srw',
]);
const IMAGE_EXTENSIONS = new Set([
    'avif',
    'bmp',
    'gif',
    'heic',
    'heif',
    'jpeg',
    'jpg',
    'png',
    'tif',
    'tiff',
    'webp',
]);
const VIDEO_EXTENSIONS = new Set([
    '3gp',
    'avi',
    'm2ts',
    'm4v',
    'mkv',
    'mov',
    'mp4',
    'mpeg',
    'mpg',
    'mts',
    'webm',
    'wmv',
]);

export type MediaKind = 'raw' | 'image' | 'video';

/**
 * What kind of media a file row holds. Extension wins over the
 * client-supplied mime type, which browsers get wrong for RAW and HEIC.
 *
 * Lives here rather than in the worker so web and worker classify the same
 * way — the worker decides whether a thumbnail is possible, the dashboard
 * decides which icon to show, and they must agree (#364, #362). Its own
 * module, not the files repository, so the dashboard can import it without
 * pulling drizzle into the client bundle.
 */
export function classifyMedia(
    file: Pick<File, 'name' | 'mimeType'>
): MediaKind | null {
    const ext = extension(file.name);
    if (RAW_EXTENSIONS.has(ext)) return 'raw';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (file.mimeType?.startsWith('image/')) return 'image';
    if (file.mimeType?.startsWith('video/')) return 'video';
    return null;
}

/**
 * Lowercased extension without the dot, or `''` when there isn't one.
 * Hand-rolled rather than `path.extname` so this module stays free of node
 * builtins and can be imported from a client component. Matches `extname`'s
 * treatment of a leading dot: `.nef` is a dotfile, not a RAW image.
 */
function extension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}
