import { classifyMedia } from '@nexus/db/media';
import type { PickedFile } from './fileSystemAccess';

/** What the kept prefix looks like, reported on the `drop_capped` event. */
export interface CappedSelectionSummary {
    keptFiles: number;
    keptBytes: number;
    /** Fraction of kept files that classify as photo, RAW, or video (0–1). */
    mediaShare: number;
}

/**
 * Describe the files a capped walk kept, so the event can tell an accidental
 * home-folder drop (mostly non-media, small files) from a real archive that
 * outgrew the cap (all media). Only the kept prefix is in hand — the walk
 * stopped at `MAX_FILES_PER_DROP` without counting the rest (#402).
 */
export function summarizeCappedSelection(
    files: PickedFile[]
): CappedSelectionSummary {
    let keptBytes = 0;
    let mediaFiles = 0;
    for (const { file } of files) {
        keptBytes += file.size;
        if (classifyMedia({ name: file.name, mimeType: file.type }) !== null) {
            mediaFiles += 1;
        }
    }
    return {
        keptFiles: files.length,
        keptBytes,
        mediaShare: files.length === 0 ? 0 : mediaFiles / files.length,
    };
}
