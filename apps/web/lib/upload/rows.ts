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
