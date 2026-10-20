import { countLabel } from '@/lib/format';
import type {
    LibraryBatchSummary,
    LibraryCoverFile,
} from '@nexus/db/repo/library';

export type BatchStatus = 'archived' | 'restoring' | 'ready';

/** A batch as the library renders it, from the server's summary (#455). */
export interface BatchView {
    /** batchId, or a synthetic key for the legacy null-batch group. */
    key: string;
    batchId: string | null;
    name: string;
    fileCount: number;
    totalBytes: number;
    createdAt: Date | null;
    restoringCount: number;
    readyCount: number;
    /** Files with nothing in flight or ready: what "Restore batch" asks for. */
    archivedCount: number;
    archivedProbablyColdCount: number;
    /** Earliest expiry among the ready files: the window the batch reads as. */
    readyUntil: Date | null;
    status: BatchStatus;
    /**
     * Searching, and in the results for its files: how many match. Null when
     * the whole batch shows.
     */
    matchCount: number | null;
    /** Up to three files whose thumbnails make the cover mosaic. */
    coverFiles: LibraryCoverFile[];
    /** How many files its Upload click sent, when that was recorded. */
    expectedFileCount: number | null;
    /** Files that never finished uploading (#550); 0 for a whole batch. */
    missingFileCount: number;
}

export const UNGROUPED_KEY = 'ungrouped';

export function batchKeyOf(batchId: string | null): string {
    return batchId ?? UNGROUPED_KEY;
}

export function batchIdOf(key: string): string | null {
    return key === UNGROUPED_KEY ? null : key;
}

export function toBatchView(summary: LibraryBatchSummary): BatchView {
    const { batchId, name, fileCount, restoringCount, readyCount } = summary;
    return {
        ...summary,
        key: batchKeyOf(batchId),
        name: name ?? 'Ungrouped',
        archivedCount: fileCount - restoringCount - readyCount,
        status: batchStatus(restoringCount, readyCount),
    };
}

// A batch reads as its most active state: anything in flight wins over
// anything downloadable.
function batchStatus(restoringCount: number, readyCount: number): BatchStatus {
    if (restoringCount > 0) return 'restoring';
    if (readyCount > 0) return 'ready';
    return 'archived';
}

/** The folder row's label: its path, or where top-level files sit. */
export function folderLabel(subpath: string | null): string {
    return subpath ?? 'Top level';
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

/** How far the restore bar fills: never so little it reads as empty. */
export function restoringPercent(batch: BatchView): number {
    return Math.max(3, (batch.restoringCount / batch.fileCount) * 100);
}
