import { deriveStatus } from '@/components/dashboard/file-browser/status';
import type { FileBatchGroup, FileWithRetrieval } from '@nexus/db/repo/files';

export type BatchStatus = 'archived' | 'restoring' | 'ready';

export interface BatchSummary {
    /** batchId, or a synthetic key for the legacy null-batch group. */
    key: string;
    batchId: string | null;
    name: string;
    /** The files this view shows — every file, or only the search matches. */
    files: FileWithRetrieval[];
    /** The batch's full size, regardless of search. */
    totalFileCount: number;
    totalBytes: number;
    createdAt: Date | null;
    restoringCount: number;
    readyCount: number;
    /** Earliest expiry among the ready files: the window the batch reads as. */
    readyUntil: Date | null;
    status: BatchStatus;
    /** Up to three files whose thumbnails make the cover mosaic. */
    coverFiles: FileWithRetrieval[];
}

export const UNGROUPED_KEY = 'ungrouped';
const COVER_SIZE = 3;

/**
 * Prototype stand-in for #455's aggregate batch query: the summaries are
 * derived in the browser from `files.listGrouped`, which still loads the whole
 * library. The shape is what the paged server summary would return.
 */
export function summarizeBatches(
    groups: FileBatchGroup[],
    search: string
): BatchSummary[] {
    const query = search.trim().toLowerCase();
    const summaries: BatchSummary[] = [];
    for (const group of groups) {
        const name = group.batchName ?? 'Ungrouped';
        const isNameMatch = !query || name.toLowerCase().includes(query);
        // A batch-name match shows the whole batch; otherwise only the files
        // whose names match (#455 § Search).
        const files = isNameMatch
            ? group.files
            : group.files.filter((f) => f.name.toLowerCase().includes(query));
        if (files.length === 0) continue;
        summaries.push(summarize(group, name, files));
    }
    return summaries;
}

function summarize(
    group: FileBatchGroup,
    name: string,
    files: FileWithRetrieval[]
): BatchSummary {
    let restoringCount = 0;
    let readyCount = 0;
    let readyUntil: Date | null = null;
    for (const file of group.files) {
        const status = deriveStatus(file);
        if (status === 'retrieving') restoringCount++;
        if (status === 'available') {
            readyCount++;
            const expiresAt = file.activeRetrieval?.expiresAt;
            if (expiresAt && (!readyUntil || expiresAt < readyUntil)) {
                readyUntil = new Date(expiresAt);
            }
        }
    }
    return {
        key: group.batchId ?? UNGROUPED_KEY,
        batchId: group.batchId,
        name,
        files,
        totalFileCount: group.files.length,
        totalBytes: group.files.reduce((sum, f) => sum + (f.size ?? 0), 0),
        createdAt: group.batchCreatedAt,
        restoringCount,
        readyCount,
        readyUntil,
        status: batchStatus(restoringCount, readyCount),
        coverFiles: pickCoverFiles(files),
    };
}

// A batch reads as its most active state: anything in flight wins over
// anything downloadable.
function batchStatus(restoringCount: number, readyCount: number): BatchStatus {
    if (restoringCount > 0) return 'restoring';
    if (readyCount > 0) return 'ready';
    return 'archived';
}

// Thumbnailed files first, so a batch that opens with a PDF still gets a
// photo cover; anything short of three fills from the rest in order.
function pickCoverFiles(files: FileWithRetrieval[]): FileWithRetrieval[] {
    const withThumbnail = files.filter((f) => f.thumbnailStatus === 'ready');
    const cover = withThumbnail.slice(0, COVER_SIZE);
    for (const file of files) {
        if (cover.length >= COVER_SIZE) break;
        if (!cover.includes(file)) cover.push(file);
    }
    return cover;
}

export function formatTimeLeft(until: Date | null): string | null {
    if (!until) return null;
    const ms = until.getTime() - Date.now();
    if (ms <= 0) return 'expiring';
    const hours = ms / 3_600_000;
    if (hours < 24) return `${Math.max(1, Math.round(hours))}h left`;
    return `${countLabel(Math.floor(hours / 24), 'day')} left`;
}

export function formatBatchDate(date: Date | null): string | null {
    if (!date) return null;
    const d = new Date(date);
    const isSameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: isSameYear ? undefined : 'numeric',
    });
}

export const formatCount = (n: number): string => n.toLocaleString('en-US');

/** "1 file", "1,204 files". */
export function countLabel(n: number, noun: string): string {
    return `${formatCount(n)} ${n === 1 ? noun : `${noun}s`}`;
}
