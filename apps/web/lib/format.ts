import { format, formatDistanceToNow } from 'date-fns';

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (
        Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    );
}

export function formatDate(date: Date | string): string {
    return format(new Date(date), 'MMM d, yyyy');
}

export function formatRelativeTime(date: Date | string): string {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/**
 * Download-window copy for a ready retrieval, identical for both storage
 * tiers: standard fast-path rows carry a synthetic expiresAt, Deep Archive
 * rows the real S3 restore expiry (#257). Null when there is no window to
 * show. Shared by the file browser and the dashboard retrievals card so the
 * copy can't drift between them.
 */
export function formatDownloadWindow(
    status: string,
    expiresAt: Date | string | null
): string | null {
    if (status !== 'ready' || !expiresAt) return null;
    return `until ${formatDate(expiresAt)}`;
}
