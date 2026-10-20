'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { createSemaphore } from '@nexus/async';
import { getQueryClient, getTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { createFireAndForgetFn, createMutateFn } from '@/lib/trpc/mutate';
import { invalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { xhrPut } from '@/lib/http/xhr';
import type { UploadApi, UploadQueue } from '@/lib/upload/queue';
import {
    isFileSystemAccessSupported,
    reacquireMatchingFile,
} from '@/lib/upload/fileSystemAccess';
import { CONFIRM_RETRIES, S3_CONNECTION_BUDGET } from '@/lib/upload/limits';
import { summarizeWave, type WaveSummary } from '@/lib/upload/parts';
import type { WaveEstimate } from '@/lib/upload/rate';
import type { UploadFile, UploadRow } from '@/lib/upload/rows';
import {
    createUploadSession,
    EMPTY_UPLOAD_SNAPSHOT,
    type UploadSession,
    type UploadSnapshot,
} from '@/lib/upload/session';
import {
    addCompletedPart,
    deleteUpload,
    listUploads,
    putUpload,
} from '@/lib/upload/uploadStore';

export type { UploadFile, UploadStatus } from '@/lib/upload/rows';

// One budget for the whole tab, shared across every engine and file.
const s3Budget = createSemaphore(S3_CONNECTION_BUDGET);

let session: UploadSession | null = null;

/**
 * The tab's upload session (`lib/upload/session.ts`), built on first use in
 * the browser: rows in a store of their own, server calls through the app's
 * QueryClient and tRPC client, browser events driving the queue. The
 * decisions all live in the queue, which is where they're tested.
 */
function getUploadSession(): UploadSession {
    session ??= createUploadSession({
        api: createUploadApi(),
        store: { putUpload, addCompletedPart, deleteUpload, listUploads },
        put: xhrPut,
        s3Budget,
        onWaveDrained: () => invalidateFileList(getQueryClient(), getTRPC()),
        notify: {
            info: (message) => toast.info(message),
            error: (message) => toast.error(message),
        },
        reacquireFile: reacquireRowFile,
        isOnline: navigatorIsOnline,
        isFileSystemAccessSupported,
        connection: window,
        now: Date.now,
    });
    return session;
}

// Module-level, so every subscriber shares one identity and the session is
// only built once something in the browser actually reads it.
const subscribe = (listener: () => void) =>
    getUploadSession().subscribe(listener);
const getSnapshot = () => getUploadSession().getSnapshot();
const getServerSnapshot = () => EMPTY_UPLOAD_SNAPSHOT;

function useUploadSnapshot(): UploadSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The queue as the upload page renders and drives it. */
export function useUpload() {
    const { rows, isUploading } = useUploadSnapshot();
    // Expose only the public UploadFile shape (strip internal fields)
    const files: UploadFile[] = rows.map(toPublicUploadFile);
    return { files, isUploading, ...uploadActions };
}

/** The running wave, for anything outside the upload page that shows it. */
export function useUploadWave(): WaveSummary {
    const { rows, isUploading } = useUploadSnapshot();
    return summarizeWave(rows, isUploading);
}

// Re-read on a clock rather than on progress, so a stall slows the rate and,
// once it outlasts the window, hides the estimate.
const ESTIMATE_TICK_MS = 1_000;

/** The running wave's transfer rate and time left (#407), once there's signal. */
export function useWaveEstimate(isActive: boolean): WaveEstimate | null {
    const [estimate, setEstimate] = useState<WaveEstimate | null>(null);
    useEffect(() => {
        if (!isActive) return;
        const timer = setInterval(
            () => setEstimate(getUploadSession().estimate(Date.now())),
            ESTIMATE_TICK_MS
        );
        return () => {
            clearInterval(timer);
            // The next wave starts from nothing, not from this one's figure.
            setEstimate(null);
        };
    }, [isActive]);
    return estimate;
}

// The calls releasing what a dropped row minted on the server, still on their
// way: a sign-out has to let them land while the session can authorize them.
const releasesInFlight = new Set<Promise<unknown>>();

// How long a sign-out waits on those before going ahead anyway: a hung call
// must not hang the button, and the nightly stale-upload check is the backstop.
const SIGN_OUT_RELEASE_WAIT_MS = 5_000;

/**
 * Empties the queue for a sign-out, the one way out of the dashboard that
 * leaves this tab: the next account must not inherit a wave. Same as Clear
 * all, so multipart uploads stay resumable from IndexedDB. Resolves once the
 * server has heard about every upload it released, or the wait runs out.
 */
export async function clearUploadsForSignOut(): Promise<void> {
    session?.queue.clearFiles();
    await Promise.race([
        Promise.all(releasesInFlight),
        new Promise((resolve) => setTimeout(resolve, SIGN_OUT_RELEASE_WAIT_MS)),
    ]);
}

// Every server procedure the queue calls, as the mutations `useMutation`
// would build (`lib/trpc/mutate.ts`). One per procedure, shared by every file
// in flight, the way one `useMutation` was.
function createUploadApi(): UploadApi {
    const trpc = getTRPC();
    const queryClient = getQueryClient();
    return {
        upload: createMutateFn(
            queryClient,
            trpc.files.upload.mutationOptions()
        ),
        createBatch: createMutateFn(
            queryClient,
            trpc.files.createBatch.mutationOptions()
        ),
        // Confirm/complete are retried in-mutation (default backoff matches
        // retryAsync's 1s/2s/4s) because the file data is already in S3. An
        // external retryAsync loop would fire the MutationCache Sentry capture
        // (lib/trpc/query-client.ts) once per attempt instead of once per
        // failure.
        confirmUpload: createMutateFn(
            queryClient,
            trpc.files.confirmUpload.mutationOptions({
                retry: CONFIRM_RETRIES,
            })
        ),
        multipartInit: createMutateFn(
            queryClient,
            trpc.files.multipart.init.mutationOptions()
        ),
        multipartComplete: createMutateFn(
            queryClient,
            trpc.files.multipart.complete.mutationOptions({
                retry: CONFIRM_RETRIES,
            })
        ),
        // Both cleanup mutations fire and forget on a row the user already
        // dismissed, so a failure has nothing to tell them — the nightly
        // stale-`uploading` check is the backstop. Hence the shared skipToast.
        multipartAbort: createFireAndForgetFn(
            queryClient,
            trpc.files.multipart.abort.mutationOptions({
                trpc: toastContext({ skipToast: true }),
            }),
            releasesInFlight
        ),
        abandonUpload: createFireAndForgetFn(
            queryClient,
            trpc.files.abandonUpload.mutationOptions({
                trpc: toastContext({ skipToast: true }),
            }),
            releasesInFlight
        ),
        multipartListParts: createMutateFn(
            queryClient,
            trpc.files.multipart.listParts.mutationOptions()
        ),
        multipartSignParts: createMutateFn(
            queryClient,
            trpc.files.multipart.signParts.mutationOptions()
        ),
        // The vault check fails open: a lookup that errors queues everything
        // as usual, and this toast is the only thing that says the check
        // didn't run.
        findDuplicates: createMutateFn(
            queryClient,
            trpc.files.findDuplicates.mutationOptions({
                trpc: toastContext({
                    errorMessage:
                        "Couldn't check for duplicates — everything was queued",
                }),
            })
        ),
    };
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

// Module-level, so every callback keeps one identity for the life of the tab
// — a fresh prop identity per render would defeat UploadQueueRow's memo.
const getQueue = () => getUploadSession().queue;
const uploadActions: UploadActions = {
    addFiles: (picked, folderName) => getQueue().addFiles(picked, folderName),
    removeFile: (id) => getQueue().dropRow(id),
    clearFiles: () => getQueue().clearFiles(),
    startUpload: () => getQueue().startUpload(),
    // Cancel on a row in flight and Remove on a queued one are the same
    // operation behind two affordances.
    cancelFile: (id) => getQueue().dropRow(id),
    retryFile: (id) => void getQueue().retryFile(id),
    resumeWithHandle: (id) => void getQueue().resumeWithHandle(id),
    resumeAllWithHandles: () => void getQueue().resumeAllWithHandles(),
    uploadAnyway: (id) => getQueue().uploadAnyway(id),
    uploadAllAnyway: () => getQueue().uploadAllAnyway(),
};

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
