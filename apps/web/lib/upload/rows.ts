import type { CompletedPart } from './uploadStore';

export type UploadStatus =
    | 'pending'
    // Admitted to the pool but not started — distinct from `pending` so the
    // Upload button only counts files the user hasn't submitted yet, which is
    // what lets files added mid-wave join the running wave with a click.
    | 'queued'
    | 'uploading'
    | 'paused'
    | 'resumable'
    | 'complete'
    | 'error'
    // Just added, vault check in flight (#401): the row shows at once so a
    // drop never looks ignored, and the Upload button leaves it alone until
    // the check settles it into `pending` or `duplicate`.
    | 'checking'
    // Name + size matched a file already in the vault, so the Upload button
    // skips it (#401). "Upload anyway" turns it back into `pending`.
    | 'duplicate';

/** The row shape the upload queue UI renders. */
export interface UploadFile {
    id: string;
    name: string;
    size: number;
    progress: number;
    status: UploadStatus;
    error?: string;
    // Flagged by the vault check on add; survives an "upload anyway" so the
    // row can still say the second copy was deliberate.
    isDuplicate?: boolean;
    // A `resumable` row whose persisted handle can be reopened in one click,
    // rather than requiring the user to re-add the file (Chromium only).
    isQuickResumable?: boolean;
    // Raw bytes when attached this session — drives the upload zone's local
    // blob previews. Null for rows restored after a reload until re-attached.
    previewFile?: File | null;
}

/** A queue row as the engine sees it: the public shape plus upload state. */
export interface UploadRow extends UploadFile {
    // Null for an interrupted upload detected on reload — the bytes are gone
    // until the user re-adds the file (or one-click reopens its handle), at
    // which point we reattach and resume.
    file: File | null;
    // Persisted File System Access handle; lets us silently reopen the bytes on
    // reload. Carried from the picker/drop and written into the IndexedDB record.
    fileHandle?: FileSystemFileHandle;
    // Identity field a reopened handle must match before we trust it to resume.
    lastModified?: number;
    fileId?: string;
    // Session batch the file belongs to — set once per Upload click and kept
    // across failures so a retry/resume rejoins the same batch.
    batchId?: string;
    // Folder gesture that queued this row, when it came from one. Consulted
    // only for rows still awaiting a batch — it names the batch they land in.
    folderOrigin?: FolderOrigin;
    uploadId?: string;
    chunkSize?: number;
    totalParts?: number;
    // Best-effort local cache of finished parts; S3 ListParts is the source of
    // truth reconciled on every resume.
    completedParts?: CompletedPart[];
    abortController?: AbortController;
}

/**
 * Identity-preserving patch for upload queue rows.
 *
 * Returns the *same* array when the patch changes nothing, so a
 * `setState((prev) => patchRowById(prev, ...))` commits no render for a no-op
 * update. That's the whole defense against progress-event floods: XHR fires
 * `onprogress` per network buffer, but a row's rounded percent only moves ~100
 * times per file, and every event in between must not reconcile the queue.
 * Rows other than the patched one keep their references, which is what lets a
 * memoized row component skip them.
 */
export function patchRowById<T extends { id: string }>(
    rows: T[],
    id: string,
    updates: Partial<T>
): T[] {
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return rows;
    const row = rows[index];
    if (isNoopPatch(row, updates)) return rows;
    const next = rows.slice();
    next[index] = { ...row, ...updates };
    return next;
}

/**
 * Bulk sibling of `patchRowById` with the same identity contract: one pass
 * over the queue, so settling a re-dropped shoot's thousands of rows costs one
 * array copy rather than one per row. The same array comes back when no row
 * actually changes, and untouched rows keep their references. `updates` may
 * be a function when each matching row needs its own patch.
 */
export function patchRowsWhere<T extends object>(
    rows: T[],
    predicate: (row: T) => boolean,
    updates: Partial<T> | ((row: T) => Partial<T>)
): T[] {
    let next: T[] | null = null;
    rows.forEach((row, index) => {
        if (!predicate(row)) return;
        const patch = typeof updates === 'function' ? updates(row) : updates;
        if (isNoopPatch(row, patch)) return;
        next ??= rows.slice();
        next[index] = { ...row, ...patch };
    });
    return next ?? rows;
}

function isNoopPatch<T extends object>(row: T, patch: Partial<T>): boolean {
    const keys = Object.keys(patch) as (keyof T)[];
    return keys.every((key) => Object.is(row[key], patch[key]));
}

/**
 * The folder gesture a row arrived on. `gestureId` is what makes "one folder"
 * decidable — two drops of same-named folders are two gestures, and only a
 * wave that is unanimously one of them gets named after it (#395). An explicit
 * id rather than object identity, so the rule survives a row being cloned.
 */
export interface FolderOrigin {
    gestureId: number;
    name: string;
}

/**
 * The folder name to label a wave's batch with, or undefined to leave it to the
 * server's timestamp fallback. Set only when every row joining the new batch
 * came from the same folder gesture — a loose file or a second folder in the
 * mix makes the batch about more than one folder, so it stays generically named.
 */
export function resolveUnanimousFolderName(
    rows: { folderOrigin?: FolderOrigin }[]
): string | undefined {
    const origin = rows[0]?.folderOrigin;
    if (!origin) return undefined;
    return rows.every((row) => row.folderOrigin?.gestureId === origin.gestureId)
        ? origin.name
        : undefined;
}
