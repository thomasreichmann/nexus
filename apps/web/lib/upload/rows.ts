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
    const keys = Object.keys(updates) as (keyof T)[];
    if (keys.every((key) => Object.is(row[key], updates[key]))) return rows;
    const next = rows.slice();
    next[index] = { ...row, ...updates };
    return next;
}
