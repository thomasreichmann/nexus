import type { CompletedPart, ResumableUpload } from './uploadStore';

/**
 * Pure helpers for resumable multipart math, split out so the upload engine's
 * orchestration logic stays testable without IndexedDB, XHR, or React.
 */

export interface FileIdentity {
    name: string;
    size: number;
    lastModified: number;
}

/** Does a re-added file match a persisted upload? Identity = name + size + mtime. */
export function isFileMatch(record: FileIdentity, file: FileIdentity): boolean {
    return (
        record.name === file.name &&
        record.size === file.size &&
        record.lastModified === file.lastModified
    );
}

/**
 * Part numbers (1-indexed) still left to upload, given which parts S3 already
 * holds. Sorted ascending so progress moves forward predictably.
 */
export function computeRemainingPartNumbers(
    totalParts: number,
    completedParts: CompletedPart[]
): number[] {
    const done = new Set(completedParts.map((p) => p.partNumber));
    const remaining: number[] = [];
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (!done.has(partNumber)) remaining.push(partNumber);
    }
    return remaining;
}

/**
 * Merge already-completed parts (from S3 ListParts and/or local state) with
 * newly uploaded ones into the sorted, deduped list S3's CompleteMultipartUpload
 * expects. Later entries win on conflict so a re-uploaded part's fresh ETag
 * replaces a stale one.
 */
export function mergeParts(...groups: CompletedPart[][]): CompletedPart[] {
    const byNumber = new Map<number, CompletedPart>();
    for (const group of groups) {
        for (const part of group) {
            byNumber.set(part.partNumber, part);
        }
    }
    return [...byNumber.values()].sort((a, b) => a.partNumber - b.partNumber);
}

/** Byte range for a part number (1-indexed) given the chunk size and file size. */
export function partByteRange(
    partNumber: number,
    chunkSize: number,
    fileSize: number
): { start: number; end: number } {
    const start = (partNumber - 1) * chunkSize;
    const end = Math.min(start + chunkSize, fileSize);
    return { start, end };
}

/** Progress as a 0-100 integer from completed vs total parts. */
export function partsProgress(completed: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((completed / total) * 100);
}

/** Snapshot the fields a re-added file must match against a persisted record. */
export function toFileIdentity(file: File): FileIdentity {
    return {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
    };
}

/** A record is resumable iff S3 hasn't received every part yet. */
export function isResumable(record: ResumableUpload): boolean {
    return record.completedParts.length < record.totalParts;
}
