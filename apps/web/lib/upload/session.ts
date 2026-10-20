import {
    createUploadQueue,
    type UploadQueue,
    type UploadQueueDeps,
} from './queue';
import type { UploadRow } from './rows';

/**
 * The upload queue and its rows, held outside React for the life of the tab
 * (#399). A wave used to live in the upload page's tree, so leaving the page
 * killed every upload in flight; now the page is one view of it and the
 * header's pill another, and either can unmount without touching the wave.
 *
 * Shaped for `useSyncExternalStore`: `getSnapshot` returns the same object
 * until something changes, and a row write that changes nothing (the
 * identity-preserving patches in ./rows) notifies no one.
 */

export interface UploadSnapshot {
    rows: UploadRow[];
    isUploading: boolean;
}

export interface UploadSession {
    queue: UploadQueue;
    subscribe(listener: () => void): () => void;
    getSnapshot(): UploadSnapshot;
}

export interface UploadSessionDeps extends Omit<
    UploadQueueDeps,
    'rows' | 'setIsUploading'
> {
    /** Where the browser's `online` / `offline` events fire: `window`. */
    connection: Pick<EventTarget, 'addEventListener'>;
}

/** What there is before a session exists, server render included. */
export const EMPTY_UPLOAD_SNAPSHOT: UploadSnapshot = {
    rows: [],
    isUploading: false,
};

/**
 * Builds the queue over a store of its own, surfaces the interrupted uploads
 * IndexedDB holds, and pauses and resumes with the connection. Once per tab:
 * nothing here is ever torn down, because the tab is the wave's lifetime.
 */
export function createUploadSession(deps: UploadSessionDeps): UploadSession {
    const { connection, ...queueDeps } = deps;
    let snapshot = EMPTY_UPLOAD_SNAPSHOT;
    const listeners = new Set<() => void>();

    const commit = (next: UploadSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const queue = createUploadQueue({
        ...queueDeps,
        rows: {
            get: () => snapshot.rows,
            set: (update) => {
                const rows = update(snapshot.rows);
                if (rows !== snapshot.rows) commit({ ...snapshot, rows });
            },
        },
        setIsUploading: (isUploading) => {
            if (isUploading !== snapshot.isUploading) {
                commit({ ...snapshot, isUploading });
            }
        },
    });

    // A drop pauses what's in flight and a reconnect resumes it. Same-session
    // resume reuses the in-memory File, so it needs nothing from the user.
    connection.addEventListener('offline', () => queue.pauseActive());
    connection.addEventListener('online', () => void queue.resumePaused());
    void queue.hydrate();

    return {
        queue,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: () => snapshot,
    };
}
