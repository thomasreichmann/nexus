'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createSemaphore } from '@nexus/async';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { xhrPut } from '@/lib/http/xhr';
import { createUploadQueue, type UploadQueue } from '@/lib/upload/queue';
import {
    isFileSystemAccessSupported,
    reacquireMatchingFile,
} from '@/lib/upload/fileSystemAccess';
import { CONFIRM_RETRIES, S3_CONNECTION_BUDGET } from '@/lib/upload/limits';
import type { UploadFile, UploadRow } from '@/lib/upload/rows';
import {
    addCompletedPart,
    deleteUpload,
    listUploads,
    putUpload,
} from '@/lib/upload/uploadStore';

export type { UploadFile, UploadStatus } from '@/lib/upload/rows';

// One budget for the whole tab, shared across every engine and file.
const s3Budget = createSemaphore(S3_CONNECTION_BUDGET);

/**
 * Binds the upload queue (`lib/upload/queue.ts`, over the transfer engines in
 * `lib/upload/transfer.ts`) to React: rows live in component state, server
 * calls go through tRPC mutations, and browser events (mount, offline/online)
 * drive the queue. The decisions all live there, which is where they're tested.
 */
export function useUpload() {
    const trpc = useTRPC();
    const [files, setFiles] = useState<UploadRow[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;

    const invalidateFileList = useInvalidateFileList();

    // These observers are shared by every file the pool runs at once. Each
    // `mutateAsync` call still builds its own mutation and resolves with its
    // own result, but the observer's `isPending`/`data`/`error` are
    // last-writer-wins across files — per-row state has to come from the row
    // itself, never from these objects.
    const mutations = {
        upload: useMutation(trpc.files.upload.mutationOptions()),
        createBatch: useMutation(trpc.files.createBatch.mutationOptions()),
        // Confirm/complete are retried in-mutation (default backoff matches
        // retryAsync's 1s/2s/4s) because the file data is already in S3. An
        // external retryAsync loop would fire the MutationCache Sentry capture
        // (lib/trpc/query-client.ts) once per attempt instead of once per
        // failure.
        confirmUpload: useMutation(
            trpc.files.confirmUpload.mutationOptions({
                retry: CONFIRM_RETRIES,
            })
        ),
        multipartInit: useMutation(trpc.files.multipart.init.mutationOptions()),
        multipartComplete: useMutation(
            trpc.files.multipart.complete.mutationOptions({
                retry: CONFIRM_RETRIES,
            })
        ),
        // Both cleanup mutations fire and forget on a row the user already
        // dismissed, so a failure has nothing to tell them — the nightly
        // stale-`uploading` check is the backstop. Hence the shared skipToast.
        multipartAbort: useMutation(
            trpc.files.multipart.abort.mutationOptions({
                trpc: toastContext({ skipToast: true }),
            })
        ),
        abandonUpload: useMutation(
            trpc.files.abandonUpload.mutationOptions({
                trpc: toastContext({ skipToast: true }),
            })
        ),
        multipartListParts: useMutation(
            trpc.files.multipart.listParts.mutationOptions()
        ),
        multipartSignParts: useMutation(
            trpc.files.multipart.signParts.mutationOptions()
        ),
        // The vault check fails open: a lookup that errors queues everything
        // as usual, and this toast is the only thing that says the check
        // didn't run.
        findDuplicates: useMutation(
            trpc.files.findDuplicates.mutationOptions({
                trpc: toastContext({
                    errorMessage:
                        "Couldn't check for duplicates — everything was queued",
                }),
            })
        ),
    };

    // The queue is built once per mount and must outlive re-renders — a pool
    // rebuilt mid-wave would lose its in-flight set — so everything that
    // re-forms per render reaches it through refs.
    const mutationsRef = useRef(mutations);
    mutationsRef.current = mutations;
    const invalidateFileListRef = useRef(invalidateFileList);
    invalidateFileListRef.current = invalidateFileList;

    const boundRef = useRef<BoundQueue | null>(null);
    boundRef.current ??= bindQueue(
        createUploadQueue({
            api: {
                upload: (input) =>
                    mutationsRef.current.upload.mutateAsync(input),
                createBatch: (input) =>
                    mutationsRef.current.createBatch.mutateAsync(input),
                confirmUpload: (input) =>
                    mutationsRef.current.confirmUpload.mutateAsync(input),
                abandonUpload: (input) =>
                    mutationsRef.current.abandonUpload.mutate(input),
                multipartInit: (input) =>
                    mutationsRef.current.multipartInit.mutateAsync(input),
                multipartListParts: (input) =>
                    mutationsRef.current.multipartListParts.mutateAsync(input),
                multipartSignParts: (input) =>
                    mutationsRef.current.multipartSignParts.mutateAsync(input),
                multipartComplete: (input) =>
                    mutationsRef.current.multipartComplete.mutateAsync(input),
                multipartAbort: (input) =>
                    mutationsRef.current.multipartAbort.mutate(input),
                findDuplicates: (input) =>
                    mutationsRef.current.findDuplicates.mutateAsync(input),
            },
            store: { putUpload, addCompletedPart, deleteUpload, listUploads },
            put: xhrPut,
            s3Budget,
            rows: { get: () => filesRef.current, set: setFiles },
            setIsUploading,
            onWaveDrained: () => invalidateFileListRef.current(),
            notify: {
                info: (message) => toast.info(message),
                error: (message) => toast.error(message),
            },
            reacquireFile: reacquireRowFile,
            isOnline: navigatorIsOnline,
            isFileSystemAccessSupported,
        })
    );
    const { queue, actions } = boundRef.current;

    // Surface interrupted uploads found in IndexedDB on mount. Once per mount;
    // the queue's dedupe (by fileId) keeps it idempotent under React
    // StrictMode's double-invoked effects, so no cancel flag needed.
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
        void queue.hydrate();
    }, [queue]);

    // Pause the active upload(s) when the browser goes offline; auto-resume the
    // paused ones when it comes back. Same-session resume reuses the in-memory
    // File, so it needs no user action.
    useEffect(() => {
        const onOffline = () => queue.pauseActive();
        const onOnline = () => void queue.resumePaused();
        window.addEventListener('offline', onOffline);
        window.addEventListener('online', onOnline);
        return () => {
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('online', onOnline);
        };
    }, [queue]);

    // Expose only the public UploadFile shape (strip internal fields)
    const publicFiles: UploadFile[] = files.map(toPublicUploadFile);

    return { files: publicFiles, isUploading, ...actions };
}

interface UploadActions {
    addFiles: UploadQueue['addFiles'];
    removeFile: (id: string) => void;
    clearFiles: () => void;
    startUpload: () => Promise<void>;
    cancelFile: (id: string) => void;
    retryFile: (id: string) => void;
    resumeWithHandle: (id: string) => void;
    resumeAllWithHandles: () => void;
    uploadAnyway: (id: string) => void;
    uploadAllAnyway: () => void;
}

interface BoundQueue {
    queue: UploadQueue;
    actions: UploadActions;
}

// Built once per mount alongside the queue, so every callback keeps one
// identity for the life of the mount — a fresh prop identity per render would
// defeat UploadQueueRow's memo.
function bindQueue(queue: UploadQueue): BoundQueue {
    return {
        queue,
        actions: {
            addFiles: queue.addFiles,
            removeFile: queue.dropRow,
            clearFiles: queue.clearFiles,
            startUpload: queue.startUpload,
            // Cancel on a row in flight and Remove on a queued one are the
            // same operation behind two affordances.
            cancelFile: queue.dropRow,
            retryFile: (id) => void queue.retryFile(id),
            resumeWithHandle: (id) => void queue.resumeWithHandle(id),
            resumeAllWithHandles: () => void queue.resumeAllWithHandles(),
            uploadAnyway: queue.uploadAnyway,
            uploadAllAnyway: queue.uploadAllAnyway,
        },
    };
}

// Public projection, cached per internal row object. Internal rows are
// immutable (row updates replace, never mutate), so an unchanged row projects
// to the *same* public object across renders — which is what lets the
// memoized queue row skip reconciling the 50+ siblings a progress tick
// didn't touch.
const publicRowCache = new WeakMap<UploadRow, UploadFile>();

function toPublicUploadFile(row: UploadRow): UploadFile {
    let cached = publicRowCache.get(row);
    if (!cached) {
        cached = {
            id: row.id,
            name: row.name,
            size: row.size,
            progress: row.progress,
            status: row.status,
            error: row.error,
            isQuickResumable: row.isQuickResumable,
            isDuplicate: row.isDuplicate,
            previewFile: row.file,
        };
        publicRowCache.set(row, cached);
    }
    return cached;
}

// Reopen the bytes behind a resumable row's persisted handle, verifying identity.
// Resolves to null (so the caller falls back to re-add) when there's no handle or
// it can't be reopened.
function reacquireRowFile(row: UploadRow): Promise<File | null> {
    if (!row.fileHandle) return Promise.resolve(null);
    return reacquireMatchingFile(row.fileHandle, {
        name: row.name,
        size: row.size,
        lastModified: row.lastModified ?? 0,
    });
}

// Wrapped so it's easy to reason about in non-browser contexts; the engine
// only calls it to decide pause-vs-fail and whether to start a queued file.
function navigatorIsOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
}
