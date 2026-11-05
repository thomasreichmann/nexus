import {
    createUploadQueue,
    type UploadQueue,
    type UploadQueueDeps,
} from './queue';
import { sumBytesLeft } from './parts';
import { createRateMeter, type WaveEstimate } from './rate';
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

/**
 * What the user has chosen for the batch the next Upload click makes (#454).
 * Kept with the rows rather than in the page, so it outlives a trip away and
 * back the way the queue does.
 */
export interface UploadDraft {
    /** The batch name as typed; undefined until the user types one. */
    name?: string;
    /** One of the user's batches to add the files to instead. */
    target?: { batchId: string; name: string };
    isSplitBySubfolder: boolean;
}

export interface UploadSnapshot {
    rows: UploadRow[];
    isUploading: boolean;
    draft: UploadDraft;
}

export interface UploadSession {
    queue: UploadQueue;
    subscribe(listener: () => void): () => void;
    getSnapshot(): UploadSnapshot;
    /** The running wave's rate and time left at `at`, once there's signal. */
    estimate(at: number): WaveEstimate | null;
    setDraft(changes: Partial<UploadDraft>): void;
    /** The Upload click, with the draft's choices; the next starts fresh. */
    startUpload(): Promise<void>;
    /** Clear all: the queue, and the choices made for it. */
    clearFiles(): void;
}

export interface UploadSessionDeps extends Omit<
    UploadQueueDeps,
    'rows' | 'setIsUploading' | 'onBytesSent'
> {
    /** Where the browser's `online` / `offline` events fire: `window`. */
    connection: Pick<EventTarget, 'addEventListener'>;
    /** The clock the transfer rate is measured by: `Date.now`. */
    now(): number;
}

const NO_DRAFT: UploadDraft = { isSplitBySubfolder: false };

/** What there is before a session exists, server render included. */
export const EMPTY_UPLOAD_SNAPSHOT: UploadSnapshot = {
    rows: [],
    isUploading: false,
    draft: NO_DRAFT,
};

/**
 * Builds the queue over a store of its own, surfaces the interrupted uploads
 * IndexedDB holds, and pauses and resumes with the connection. Once per tab:
 * nothing here is ever torn down, because the tab is the wave's lifetime.
 */
export function createUploadSession(deps: UploadSessionDeps): UploadSession {
    const { connection, now, ...queueDeps } = deps;
    let snapshot = EMPTY_UPLOAD_SNAPSHOT;
    const listeners = new Set<() => void>();
    // The transfer rate (#407) lives here rather than in a component, so it
    // survives the page the way the wave does. Fed the bytes the XHRs report
    // as they go, never the rows' whole percents: those move once per 1% of
    // a file, which for one large file is too rare to measure, and a resumed
    // row's already-landed bytes would read as speed.
    const meter = createRateMeter();
    let bytesSent = 0;

    const commit = (next: UploadSnapshot): void => {
        if (next.isUploading && !snapshot.isUploading) {
            meter.reset();
            meter.record(now(), bytesSent);
        }
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const queue = createUploadQueue({
        ...queueDeps,
        onBytesSent: (bytes) => {
            bytesSent += bytes;
            if (snapshot.isUploading) meter.record(now(), bytesSent);
        },
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
        estimate(at) {
            if (!snapshot.isUploading) return null;
            return meter.estimate(at, sumBytesLeft(snapshot.rows));
        },
        setDraft(changes) {
            commit({ ...snapshot, draft: { ...snapshot.draft, ...changes } });
        },
        startUpload() {
            const { name, target, isSplitBySubfolder } = snapshot.draft;
            // Spent on these files: the next ones dropped start from their
            // own folder's name, as a new batch.
            if (snapshot.draft !== NO_DRAFT) {
                commit({ ...snapshot, draft: NO_DRAFT });
            }
            return queue.startUpload({
                name,
                targetBatchId: target?.batchId,
                isSplitBySubfolder,
            });
        },
        clearFiles() {
            queue.clearFiles();
            if (snapshot.draft !== NO_DRAFT) {
                commit({ ...snapshot, draft: NO_DRAFT });
            }
        },
    };
}
