import type { UploadFile } from './rows';
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

/**
 * The one place the identity tuple is spelled out: name + size + mtime.
 * `isFileMatch` derives from it so the predicate and the map key can't drift.
 */
export function toFileIdentityKey(identity: FileIdentity): string {
    return JSON.stringify([
        identity.name,
        identity.size,
        identity.lastModified,
    ]);
}

/** Does a re-added file match a persisted upload? */
export function isFileMatch(record: FileIdentity, file: FileIdentity): boolean {
    return toFileIdentityKey(record) === toFileIdentityKey(file);
}

/**
 * Persisted uploads keyed by identity, so a library-sized gesture (#402)
 * matches in one pass instead of files × records. First record wins, as the
 * linear scan it replaced did.
 */
export function indexByFileIdentity(
    records: ResumableUpload[]
): Map<string, ResumableUpload> {
    const index = new Map<string, ResumableUpload>();
    for (const record of records) {
        const key = toFileIdentityKey(record);
        if (!index.has(key)) index.set(key, record);
    }
    return index;
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

/**
 * Progress as a 0-100 integer from the bytes the completed parts hold: the
 * same measure the multipart engine reports while it runs (#407), so a
 * resumed upload's bar picks up where it stopped. Sized part by part rather
 * than counted, since the last one is usually short.
 */
export function computeLandedProgress(
    completedParts: CompletedPart[],
    chunkSize: number,
    fileSize: number
): number {
    if (fileSize <= 0) return 0;
    const landedBytes = completedParts.reduce((sum, part) => {
        const { start, end } = partByteRange(
            part.partNumber,
            chunkSize,
            fileSize
        );
        return sum + (end - start);
    }, 0);
    return Math.round((landedBytes / fileSize) * 100);
}

/**
 * Aggregate progress of an upload wave as a 0-100 integer, byte-weighted:
 * one 80GB video outweighs a folder of JPEGs. Callers pass the rows that
 * belong to the wave; this doesn't know about statuses.
 */
export function waveProgress(
    rows: { size: number; progress: number }[]
): number {
    const totalBytes = rows.reduce((acc, row) => acc + row.size, 0);
    if (totalBytes <= 0) return 0;
    const doneBytes = rows.reduce(
        (acc, row) => acc + (row.size * row.progress) / 100,
        0
    );
    return Math.round((doneBytes / totalBytes) * 100);
}

export interface WaveSummary {
    /**
     * Whether a wave is running. Live while the pool holds rows, too:
     * `isUploading` alone blinks off during the batch-creation await, before
     * any row is admitted.
     */
    isActive: boolean;
    /** The wave's rows: everything the user has submitted. */
    fileCount: number;
    completedCount: number;
    errorCount: number;
    /** `waveProgress` over the same rows the counts are of. */
    percent: number;
}

/**
 * One description of the wave, for the upload page's header and the
 * header's pill (#399), so the two can never disagree about it. Paused rows
 * are in: a row parked by a connection drop is still the wave's work. Rows
 * the user hasn't submitted (pending, resumable, still being checked, or
 * skipped as a duplicate) are not.
 */
export function summarizeWave(
    rows: WaveRow[],
    isUploading: boolean
): WaveSummary {
    const waveRows = rows.filter(isWaveRow);
    const countOf = (status: UploadFile['status']) =>
        waveRows.filter((row) => row.status === status).length;
    const inFlightCount = countOf('queued') + countOf('uploading');
    return {
        isActive: isUploading || inFlightCount > 0,
        fileCount: waveRows.length,
        completedCount: countOf('complete'),
        errorCount: countOf('error'),
        percent: waveProgress(waveRows),
    };
}

/**
 * The bytes the wave still has to send, for its time left (#407). Only rows
 * something is going to send: a failed row waits on a Retry nobody may click,
 * and counting it would hold "time left" above zero to the end.
 */
export function sumBytesLeft(rows: WaveRow[]): number {
    let left = 0;
    for (const row of rows) {
        if (!STILL_SENDING.has(row.status)) continue;
        left += (row.size * (100 - row.progress)) / 100;
    }
    return left;
}

const STILL_SENDING = new Set<UploadFile['status']>([
    'queued',
    'uploading',
    'paused',
]);

type WaveRow = Pick<UploadFile, 'status' | 'size' | 'progress'>;

// Not submitted, so not the wave's work: pending, resumable, still being
// checked, or skipped as a duplicate.
function isWaveRow(row: WaveRow): boolean {
    return (
        row.status !== 'pending' &&
        row.status !== 'resumable' &&
        row.status !== 'checking' &&
        row.status !== 'duplicate'
    );
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
