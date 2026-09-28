import { planVaultLookups, vaultKey, type VaultIdentity } from './duplicates';
import { createFilePool, type FileRunOutcome } from './filePool';
import { MAX_CONCURRENT_FILES, MAX_IN_FLIGHT_BYTES } from './limits';
import {
    indexByFileIdentity,
    isResumable,
    partsProgress,
    toFileIdentity,
    toFileIdentityKey,
} from './parts';
import {
    patchRowById,
    patchRowsWhere,
    resolveUnanimousFolderName,
    type UploadRow,
} from './rows';
import {
    CANCEL,
    createTransfers,
    PAUSE,
    type TransferApi,
    type TransferDeps,
    type TransferStore,
} from './transfer';
import type { PickedFile } from './fileSystemAccess';
import type { ResumableUpload } from './uploadStore';

/**
 * The upload queue's engine: intake (resume matching + the vault check), the
 * Upload click, the file pool, retry, pause/resume, and teardown. It owns the
 * decisions; the caller owns where rows live. `useUpload` binds it to React
 * state, and tests bind it to a plain array (./testing).
 */

/** Every server procedure the queue calls. */
export interface UploadApi extends TransferApi {
    createBatch(input: { name?: string }): Promise<{ batchId: string }>;
    findDuplicates(input: { files: VaultIdentity[] }): Promise<VaultIdentity[]>;
    /** Fire and forget: releases an S3 multipart session being dropped. */
    multipartAbort(input: { fileId: string; uploadId: string }): void;
}

export interface UploadStoreApi extends TransferStore {
    listUploads(): Promise<ResumableUpload[]>;
}

export interface UploadQueueDeps extends Omit<
    TransferDeps,
    'api' | 'store' | 'updateRow'
> {
    api: UploadApi;
    store: UploadStoreApi;
    rows: {
        /** The rows as last committed. May lag a `set` issued just before. */
        get(): UploadRow[];
        set(update: (prev: UploadRow[]) => UploadRow[]): void;
    };
    setIsUploading(isUploading: boolean): void;
    /** Refreshes the file list; once per drained wave, not per file. */
    onWaveDrained(): unknown;
    notify: { info(message: string): void; error(message: string): void };
    /** Reopens a resumable row's persisted handle, or null if it can't. */
    reacquireFile(row: UploadRow): Promise<File | null>;
    isFileSystemAccessSupported(): boolean;
}

export interface UploadQueue {
    /** Surfaces interrupted uploads persisted in IndexedDB as `resumable` rows. */
    hydrate(): Promise<void>;
    addFiles(picked: PickedFile[], folderName?: string): Promise<void>;
    /** The Upload click: every `pending` row joins one batch and the pool. */
    startUpload(): Promise<void>;
    retryFile(id: string): Promise<void>;
    /** Remove on a queued row and Cancel on one in flight: one operation. */
    dropRow(id: string): void;
    clearFiles(): void;
    uploadAnyway(id: string): void;
    uploadAllAnyway(): void;
    resumeWithHandle(id: string): Promise<void>;
    resumeAllWithHandles(): Promise<void>;
    /** The browser went offline: pause every upload in flight. */
    pauseActive(): void;
    /** The browser came back: resume every paused row that has its bytes. */
    resumePaused(): Promise<void>;
}

/**
 * What the pool needs to admit a row: an identity to de-duplicate on, a size to
 * weigh against the in-flight byte budget, and the batch the row belongs to.
 * The row itself is re-read at start time, so nothing here can go stale.
 */
interface QueuedUpload {
    id: string;
    size: number;
    batchId?: string;
}

function toQueuedUpload(row: UploadRow, batchId?: string): QueuedUpload {
    return { id: row.id, size: row.size, batchId: batchId ?? row.batchId };
}

export function createUploadQueue(deps: UploadQueueDeps): UploadQueue {
    const { api, store, rows } = deps;
    // Monotonic per-engine counter stamped on rows by `addFiles`; see FolderOrigin.
    let folderGestureCount = 0;

    const updateRow = (id: string, updates: Partial<UploadRow>): void => {
        rows.set((prev) => patchRowById(prev, id, updates));
    };
    const findRow = (id: string): UploadRow | undefined =>
        rows.get().find((row) => row.id === id);

    const transfers = createTransfers({ ...deps, updateRow });

    // The pool re-reads the row here rather than trusting the queued snapshot:
    // between admission and start the user may have removed the row, and a
    // prior attempt may have left a fileId/uploadId worth resuming from. Only
    // the row's existence is checked, not its status — rows are read as last
    // committed, so a just-issued "pending" may not be visible yet.
    const runQueued = async (item: QueuedUpload): Promise<FileRunOutcome> => {
        const current = findRow(item.id);
        if (!current?.file) return 'continue';
        // A drop mid-wave pauses the files already in flight, but the pool
        // keeps handing out the rest of the queue. Park them in `paused`
        // alongside their siblings — the reconnect handler resumes the whole
        // set — rather than spending a doomed presign on each and leaving a
        // row in `error` that nothing comes back for.
        if (!deps.isOnline()) {
            updateRow(current.id, { status: 'paused' });
            return 'continue';
        }
        return transfers.runUpload(current, item.batchId);
    };

    const pool = createFilePool<QueuedUpload>({
        maxConcurrent: MAX_CONCURRENT_FILES,
        maxInFlightBytes: MAX_IN_FLIGHT_BYTES,
        run: runQueued,
        // Once per drained wave, not once per file: four concurrent files
        // would otherwise fire four refetch storms across three queries.
        onDrained: () => deps.onWaveDrained(),
        // A quota halt throws away the queue; put those rows back to
        // `pending` so the Upload button re-owns them instead of leaving
        // them stranded in `queued` with nothing left to start them.
        // One pass over the queue, not one `updateRow` per dropped row: at
        // the 50k drop cap a per-row patch is quadratic (#402).
        onDropped: (items) => {
            const dropped = new Set(items.map((item) => item.id));
            rows.set((prev) =>
                patchRowsWhere(prev, (row) => dropped.has(row.id), {
                    status: 'pending',
                })
            );
        },
    });

    // `isUploading` has several owners (the pool, quick-resume) and must not
    // dip between files — the Upload button reads it, so a momentary false
    // re-enables and re-labels it mid-wave.
    let activeDrivers = 0;
    const withUploadingState = async (
        work: () => Promise<void>
    ): Promise<void> => {
        activeDrivers++;
        deps.setIsUploading(true);
        try {
            await work();
        } finally {
            activeDrivers--;
            if (activeDrivers === 0) deps.setIsUploading(false);
        }
    };

    const drive = (items: QueuedUpload[]): Promise<void> =>
        withUploadingState(() => pool.enqueue(items));

    const startUpload = async (): Promise<void> => {
        const pending = rows
            .get()
            .filter((row) => row.status === 'pending' && row.file);
        if (pending.length === 0) return;

        // Claim the rows before the batch round trip: the Upload button stays
        // enabled while a wave runs (so added files can join it), which makes
        // a second click during the await possible — `queued` is what keeps
        // that click from minting a second batch for the same rows. Both row
        // writes in here are single passes: a per-row update copies the whole
        // queue each time, which cost ~17s per click at 50k rows (#402).
        const pendingIds = new Set(pending.map((row) => row.id));
        rows.set((prev) =>
            patchRowsWhere(prev, (row) => pendingIds.has(row.id), {
                status: 'queued',
            })
        );

        // One batch per Upload click: every pending file in this pass joins
        // it, so a multi-file selection lands in a single upload_batches row.
        // Created fresh per invocation — files queued later get a new batch on
        // the next click. On failure we proceed without an id and each file
        // falls back to the server's auto-created single-file batch.
        let batchId: string | undefined;
        // Rows that already have a batch (retries, re-added resumables) keep
        // it, so only mint a session batch when some file still needs one —
        // and only those rows decide what the new batch is named after.
        const rowsNeedingBatch = pending.filter((row) => !row.batchId);
        if (rowsNeedingBatch.length > 0) {
            try {
                ({ batchId } = await api.createBatch({
                    name: resolveUnanimousFolderName(rowsNeedingBatch),
                }));
            } catch {
                batchId = undefined;
            }
        }

        // Retried/resumed rows keep their original batch; only rows without
        // one join this session's batch. Written to the row for
        // retry/persistence, but carried on the queue item too — a row read
        // won't reflect this update until the next commit.
        const rowBatchIds = new Map(
            pending.map((row) => [row.id, row.batchId ?? batchId])
        );
        rows.set((prev) =>
            patchRowsWhere(
                prev,
                (row) => rowBatchIds.has(row.id),
                (row) => ({ batchId: rowBatchIds.get(row.id) })
            )
        );
        const queued = pending.map((row) =>
            toQueuedUpload(row, rowBatchIds.get(row.id))
        );

        await drive(queued);
    };

    // Records that persisted a File System Access handle (and run on a
    // browser that supports it) are marked `isQuickResumable` — the bytes can
    // be reopened in one click. The rest show until the user re-adds the
    // file. The dedupe by fileId keeps this idempotent, so a second call (React
    // StrictMode's double-invoked effects) adds nothing.
    const hydrate = async (): Promise<void> => {
        const hasFileSystemAccess = deps.isFileSystemAccessSupported();
        const records = await store.listUploads();
        const resumable = records.filter(isResumable);
        if (resumable.length === 0) return;
        rows.set((prev) => {
            const existing = new Set(prev.map((row) => row.fileId));
            const restored: UploadRow[] = resumable
                .filter((record) => !existing.has(record.fileId))
                .map((record) => ({
                    id: record.fileId,
                    name: record.name,
                    size: record.size,
                    progress: partsProgress(
                        record.completedParts.length,
                        record.totalParts
                    ),
                    status: 'resumable' as const,
                    isQuickResumable:
                        hasFileSystemAccess && !!record.fileHandle,
                    file: null,
                    fileHandle: record.fileHandle,
                    lastModified: record.lastModified,
                    fileId: record.fileId,
                    batchId: record.batchId,
                    uploadId: record.uploadId,
                    chunkSize: record.chunkSize,
                    totalParts: record.totalParts,
                    completedParts: record.completedParts,
                }));
            return restored.length > 0 ? [...prev, ...restored] : prev;
        });
    };

    const addFiles = async (
        picked: PickedFile[],
        folderName?: string
    ): Promise<void> => {
        if (picked.length === 0) return;

        // One id per call, so re-dropping the same folder counts as a second
        // gesture rather than merging into the first.
        const folderOrigin = folderName
            ? { gestureId: ++folderGestureCount, name: folderName }
            : undefined;

        // Match each file against a persisted interrupted upload so a re-add
        // resumes from where S3 left off instead of starting over. One store
        // read for the whole batch, indexed once so a library-sized drop
        // (#402) stays linear in files rather than files × records.
        const recordsByIdentity = indexByFileIdentity(
            await store.listUploads()
        );
        const matches = picked.map(({ file }) =>
            recordsByIdentity.get(toFileIdentityKey(toFileIdentity(file)))
        );

        // Ids for the rows this gesture creates, minted outside the state
        // updater (StrictMode runs updaters twice) so the vault check below
        // settles exactly these rows and no others. A re-add matched to an
        // interrupted upload takes the resume path and gets none. Every
        // progress update, cancel and retry keys on these ids, and a drop can
        // queue thousands of rows — a short Math.random id collided at that
        // scale (#410).
        const freshIds = picked.map((_, i) => {
            const match = matches[i];
            return match && isResumable(match) ? null : crypto.randomUUID();
        });

        rows.set((prev) => {
            // Reattach re-added files to their resumable rows (immutably),
            // then append rows for everything that didn't match an existing row.
            const reattach = new Map<string, PickedFile>();
            const appended: UploadRow[] = [];

            picked.forEach(({ file, handle }, i) => {
                const match = matches[i];
                const existing =
                    match && isResumable(match)
                        ? prev.find((row) => row.fileId === match.fileId)
                        : undefined;

                if (match && isResumable(match) && existing) {
                    // Re-add of an interrupted upload: queue it as resumable;
                    // clicking Upload continues from the last completed part.
                    reattach.set(existing.id, { file, handle });
                    return;
                }
                if (match && isResumable(match)) {
                    appended.push({
                        id: match.fileId,
                        name: file.name,
                        size: file.size,
                        progress: partsProgress(
                            match.completedParts.length,
                            match.totalParts
                        ),
                        status: 'pending',
                        file,
                        fileHandle: handle,
                        fileId: match.fileId,
                        batchId: match.batchId,
                        uploadId: match.uploadId,
                        chunkSize: match.chunkSize,
                        totalParts: match.totalParts,
                        completedParts: match.completedParts,
                        folderOrigin,
                    });
                    return;
                }
                appended.push({
                    id: freshIds[i]!,
                    name: file.name,
                    size: file.size,
                    progress: 0,
                    status: 'checking',
                    file,
                    fileHandle: handle,
                    folderOrigin,
                });
            });

            const updated = prev.map((row) => {
                const reattached = reattach.get(row.id);
                return reattached
                    ? {
                          ...row,
                          file: reattached.file,
                          // Keep any handle we already had if the re-add lacked one.
                          fileHandle: reattached.handle ?? row.fileHandle,
                          status: 'pending' as const,
                          progress: partsProgress(
                              row.completedParts?.length ?? 0,
                              row.totalParts ?? 0
                          ),
                      }
                    : row;
            });
            return [...updated, ...appended];
        });

        // Then one server round trip for the gesture (#401): which of the new
        // rows' name + size pairs the vault already holds. The rows are
        // already showing — a drop must never look ignored (#388) — and
        // `checking` keeps them out of the Upload button until this settles
        // them. Chunks run one at a time (a gesture over
        // MAX_FILES_PER_VAULT_LOOKUP has more than one), and a chunk that
        // fails leaves the earlier answers standing: fail open on what's
        // unknown, not on everything. The caller's error handling says the
        // check didn't run.
        const checking = new Set(
            freshIds.filter((id): id is string => id !== null)
        );
        if (checking.size === 0) return;
        const freshFiles = picked
            .filter((_, i) => freshIds[i] !== null)
            .map(({ file }) => file);
        const vaultKeys = new Set<string>();
        try {
            for (const files of planVaultLookups(freshFiles)) {
                const found = await api.findDuplicates({ files });
                for (const match of found) vaultKeys.add(vaultKey(match));
            }
        } catch {
            // Fail open — see above.
        }
        rows.set((prev) =>
            patchRowsWhere(
                prev,
                (row) => row.status === 'checking' && checking.has(row.id),
                (row) => {
                    const isDuplicate = vaultKeys.has(vaultKey(row));
                    return {
                        status: isDuplicate ? 'duplicate' : 'pending',
                        isDuplicate,
                    };
                }
            )
        );
    };

    // Release whatever the server already minted for a row we're dropping: the
    // S3 multipart session when there is one (plus its persisted state, so a
    // cancelled upload doesn't linger as resumable), otherwise the plain object
    // at the row's recorded key. A row that never reached the server has no
    // fileId and nothing to release. Fire-and-forget — the row leaves the UI
    // either way, and the nightly stale-upload check backs this up.
    const abandonServerUpload = (row: UploadRow | undefined): void => {
        // Skipping `complete` rows is an optimization, not the safety net:
        // clear-all sweeps confirmed rows too, and there's no point asking the
        // server to release an upload the UI already knows finished. Refusing
        // to touch a confirmed file is the server's job, and `releaseUpload`
        // does it for both engines.
        if (!row?.fileId || row.status === 'complete') return;
        if (row.uploadId) {
            api.multipartAbort({ fileId: row.fileId, uploadId: row.uploadId });
            void store.deleteUpload(row.fileId);
            return;
        }
        api.abandonUpload({ fileId: row.fileId });
    };

    const dropRow = (id: string): void => {
        const row = findRow(id);
        row?.abortController?.abort(CANCEL);
        abandonServerUpload(row);
        rows.set((prev) => prev.filter((r) => r.id !== id));
    };

    // Clear all empties the list; it is not a per-row "give up on this upload"
    // the way Cancel/Remove is. So it must not destroy multipart work the user
    // can still come back to: a row carrying an `uploadId` has parts in S3 and
    // a persisted record behind it, and releasing it here would abort the
    // session and delete that record, silently killing an upload the queue is
    // offering to resume. Those are left to the bucket's 7-day
    // abort-incomplete-multipart rule and the nightly stale-upload check.
    // Single-part rows mint no session and have nothing to resume, so they
    // still get released — that is the #330 leak this whole path exists for.
    const clearFiles = (): void => {
        for (const row of rows.get()) {
            row.abortController?.abort(CANCEL);
            if (row.uploadId) continue;
            abandonServerUpload(row);
        }
        rows.set(() => []);
    };

    // Retry joins the live pool rather than waiting for it to empty: with
    // several files in flight, a failed row's Retry is most often clicked while
    // its siblings are still going.
    const retryFile = async (id: string): Promise<void> => {
        const row = findRow(id);
        if (!row?.file) return;
        // Straight to `queued`, not `pending`: the row is being handed to the
        // pool right now, so it must not re-enter the Upload button's pending
        // count on the way through.
        updateRow(id, { status: 'queued', error: undefined });
        await drive([toQueuedUpload(row)]);
    };

    // "Upload anyway" for a row the vault check skipped: back to `pending`, so
    // the Upload button owns it again. `isDuplicate` stays set — the copy is
    // deliberate, and the row keeps saying so.
    const uploadAnyway = (id: string): void => {
        if (findRow(id)?.status !== 'duplicate') return;
        updateRow(id, { status: 'pending' });
    };
    const uploadAllAnyway = (): void => {
        rows.set((prev) =>
            patchRowsWhere(prev, (row) => row.status === 'duplicate', {
                status: 'pending',
            })
        );
    };

    // Reopen interrupted uploads from their persisted handles and resume them
    // through the multipart engine. Handles are reopened up front (in
    // parallel) so the permission prompts ride the single click that
    // triggered this, then resumed serially. A row whose handle can't be
    // reopened (permission denied, file moved/changed) loses its quick-resume
    // affordance and falls back to the manual re-add flow.
    const resumeRows = async (toResume: UploadRow[]): Promise<void> => {
        if (toResume.length === 0) return;
        await withUploadingState(async () => {
            const reopened = await Promise.all(
                toResume.map(async (row) => ({
                    row,
                    file: await deps.reacquireFile(row),
                }))
            );
            let hasResumedAny = false;
            for (const { row, file } of reopened) {
                if (!file) {
                    updateRow(row.id, { isQuickResumable: false });
                    continue;
                }
                hasResumedAny = true;
                // `queued`, not `pending`: the row is on its way into the
                // engine, so it must not count toward the Upload button.
                updateRow(row.id, { file, status: 'queued', error: undefined });
                await transfers.uploadMultipartFile({
                    ...row,
                    file,
                    status: 'queued',
                });
            }
            if (!hasResumedAny) {
                deps.notify.error(
                    toResume.length > 1
                        ? "Couldn't reopen the files — re-add them to resume"
                        : "Couldn't reopen the file — re-add it to resume"
                );
                return;
            }
            // The engines don't refresh the list per file — the pool does it
            // once per wave, and this path bypasses the pool.
            await deps.onWaveDrained();
        });
    };

    const pauseActive = (): void => {
        let hasPausedAny = false;
        for (const row of rows.get()) {
            if (row.status === 'uploading' && row.abortController) {
                row.abortController.abort(PAUSE);
                hasPausedAny = true;
            }
        }
        if (hasPausedAny) {
            deps.notify.info('Upload paused — waiting for your connection');
        }
    };

    const resumePaused = async (): Promise<void> => {
        const paused = rows
            .get()
            .filter((row) => row.status === 'paused' && row.file);
        if (paused.length === 0) return;
        deps.notify.info('Back online — resuming upload');
        // Back through the same pool, so a reconnect with twenty paused rows
        // resumes them four at a time rather than all at once. Each row
        // re-enters its own engine: a single-part upload paused by a drop
        // restarts from byte zero, multipart resumes its parts.
        await drive(paused.map((row) => toQueuedUpload(row)));
    };

    return {
        hydrate,
        addFiles,
        startUpload,
        retryFile,
        dropRow,
        clearFiles,
        uploadAnyway,
        uploadAllAnyway,
        resumeWithHandle: async (id) => {
            const row = findRow(id);
            if (row) await resumeRows([row]);
        },
        resumeAllWithHandles: () =>
            resumeRows(
                rows
                    .get()
                    .filter(
                        (row) =>
                            row.status === 'resumable' && row.isQuickResumable
                    )
            ),
        pauseActive,
        resumePaused,
    };
}
