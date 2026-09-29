/**
 * Test doubles for the upload engine (./queue, ./transfer): an in-memory
 * stand-in for everything the engine talks to outside the tab — the tRPC
 * upload procedures and S3's presigned PUTs — plus a harness that wires a
 * real upload queue to it.
 *
 * The backend behaves like the server rather than recording calls: confirm
 * refuses an object S3 never received, complete refuses a part list with a
 * gap or a stale ETag, and a PUT to an aborted multipart session fails. So a
 * test asserts on the outcome (the file is confirmed, the bytes assembled)
 * and an engine that skips a step goes red on its own.
 *
 * Files are fakes too: `fakeFile` reports any size without holding the bytes,
 * and its slices are byte ranges the backend can check for gaps.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createSemaphore } from '@nexus/async';
import { deferred, type Deferred } from '@nexus/async/testing';
import { UploadHttpError, type xhrPut } from '@/lib/http/xhr';
import {
    createUploadQueue,
    type UploadApi,
    type UploadQueue,
    type UploadQueueDeps,
} from './queue';
import { MULTIPART_THRESHOLD, S3_CONNECTION_BUDGET } from './limits';
import {
    addCompletedPart,
    deleteUpload,
    listUploads,
    putUpload,
    resetUploadStoreForTests,
    type CompletedPart,
} from './uploadStore';
import type { PickedFile } from './fileSystemAccess';
import type { UploadRow } from './rows';

/** The part size the fake backend cuts multipart uploads into. */
export const FAKE_CHUNK_SIZE = 25 * 1024 * 1024;
/** Just over the multipart threshold: full parts plus a one-byte last one. */
export const MULTIPART_SIZE = MULTIPART_THRESHOLD + 1;
export const MULTIPART_PARTS = Math.ceil(MULTIPART_SIZE / FAKE_CHUNK_SIZE);

/** A fresh, empty IndexedDB for the resume records; call in `beforeEach`. */
export async function resetUploadStore(): Promise<void> {
    await resetUploadStoreForTests();
    globalThis.indexedDB = new IDBFactory();
}

/** What a `fakeFile` slice is: the range, so the backend can check coverage. */
interface ByteRange {
    fileName: string;
    start: number;
    end: number;
}

// Where a fake file keeps the range a whole-file PUT sends.
const RANGE = Symbol('range');

/**
 * A File that reports `size` without allocating it. The engine only reads the
 * identity fields and slices, so this is all it can tell apart from a real one.
 */
export function fakeFile(
    name: string,
    size: number,
    options: { lastModified?: number; type?: string } = {}
): File {
    const range = (start: number, end: number): ByteRange => ({
        fileName: name,
        start,
        end: Math.min(end, size),
    });
    return {
        name,
        size,
        lastModified: options.lastModified ?? 1,
        type: options.type ?? '',
        slice: (start = 0, end = size) => range(start, end),
        [RANGE]: range(0, size),
    } as unknown as File;
}

function rangeOf(body: Blob): ByteRange {
    const whole = (body as unknown as { [RANGE]?: ByteRange })[RANGE];
    return whole ?? (body as unknown as ByteRange);
}

export function picked(...files: File[]): PickedFile[] {
    return files.map((file) => ({ file }));
}

type ServerFileStatus = 'uploading' | 'confirmed' | 'abandoned' | 'aborted';

export interface ServerFile {
    fileId: string;
    name: string;
    size: number;
    mimeType?: string;
    batchId?: string;
    engine: 'single' | 'multipart';
    status: ServerFileStatus;
    uploadId?: string;
    chunkSize?: number;
    totalParts?: number;
    /** Parts S3 holds for the multipart session, by part number. */
    parts: Map<number, { etag: string; range: ByteRange }>;
    /** The single-part object S3 holds. */
    object?: ByteRange;
}

type ApiMethod = keyof UploadApi;

/** One PUT the transport has accepted and not yet settled. */
export interface InFlightPut {
    url: string;
    fileId: string;
    fileName: string;
    /** Absent for a single-part PUT. */
    partNumber?: number;
}

interface PutEntry extends InFlightPut {
    body: ByteRange;
    onProgress?: (loaded: number, total: number) => void;
    resolve: (value: { etag: string | null }) => void;
    reject: (error: unknown) => void;
}

export interface FakeUploadBackend {
    api: UploadApi;
    put: typeof xhrPut;
    /** Every server file, attempts included, in creation order. */
    files: ServerFile[];
    /** Server files for one name, oldest attempt first. */
    filesNamed(name: string): ServerFile[];
    batches: { batchId: string; name?: string }[];
    /** Every PUT the transport received, settled or not, in order. */
    puts: InFlightPut[];
    /** Every PUT of one part number, across files and attempts. */
    putsFor(partNumber: number): InFlightPut[];
    inFlight(): InFlightPut[];
    peakInFlight(): number;
    /** Highest number of PUTs in flight at once for one server file. */
    peakInFlightFor(fileId: string): number;
    /** Files the vault already holds, for `findDuplicates`. */
    addToVault(...files: { name: string; size: number }[]): void;
    /** Hold PUTs until `completePuts` / `failPut` settles them. */
    holdPuts(): void;
    /** Back to answering PUTs at once, settling any still held. */
    releasePuts(): void;
    /** Settles held PUTs matching `where` (all by default), oldest first. */
    completePuts(where?: (put: InFlightPut) => boolean): number;
    failPut(where: (put: InFlightPut) => boolean, error: unknown): void;
    /** Held PUTs matching `where` report `loaded` bytes sent so far. */
    reportProgress(where: (put: InFlightPut) => boolean, loaded: number): void;
    /** The next `times` PUTs matching `where` fail with `error`. */
    failNextPuts(
        where: (put: InFlightPut) => boolean,
        error: unknown,
        times?: number
    ): void;
    /** Presigned URLs matching `where` answer 403 from now on. */
    expireUrls(where: (url: string) => boolean): void;
    /** The next call to `method` (after `skip` that succeed) rejects with `error`. */
    failNext(
        method: ApiMethod,
        error: unknown,
        options?: { skip?: number }
    ): void;
    /** The next call to `method` waits until the returned gate resolves. */
    holdNext(method: ApiMethod): Deferred;
}

export function createFakeUploadBackend(): FakeUploadBackend {
    const chunkSize = FAKE_CHUNK_SIZE;
    const files: ServerFile[] = [];
    const byId = new Map<string, ServerFile>();
    const batches: { batchId: string; name?: string }[] = [];
    const vault: { name: string; size: number }[] = [];
    const puts: InFlightPut[] = [];
    const inFlight: PutEntry[] = [];
    const expired: ((url: string) => boolean)[] = [];
    const putFailures: {
        where: (put: InFlightPut) => boolean;
        error: unknown;
        times: number;
    }[] = [];
    const callFailures = new Map<
        ApiMethod,
        { error: unknown; skip: number }[]
    >();
    const callHolds = new Map<ApiMethod, Deferred[]>();
    let isHoldingPuts = false;
    let peak = 0;
    const peakByFile = new Map<string, number>();
    let seq = 0;

    const nextId = (prefix: string) => `${prefix}-${++seq}`;

    // Input the router's schema would reject throws — from the
    // fire-and-forget calls too, where the real `mutate` would swallow it —
    // so a call made with a missing id goes red instead of passing silently.
    const requireIds = (method: ApiMethod, ids: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(ids)) {
            if (typeof value !== 'string' || value === '') {
                throw new Error(`${method}: invalid ${key} ${String(value)}`);
            }
        }
    };

    const call = async (method: ApiMethod): Promise<void> => {
        const hold = callHolds.get(method)?.shift();
        if (hold) await hold.promise;
        const next = callFailures.get(method)?.[0];
        if (!next) return;
        if (next.skip > 0) {
            next.skip--;
            return;
        }
        callFailures.get(method)!.shift();
        throw next.error;
    };

    const getFile = (fileId: string): ServerFile => {
        const file = byId.get(fileId);
        if (!file) throw new Error(`no such file ${fileId}`);
        return file;
    };

    const getSession = (fileId: string, uploadId: string): ServerFile => {
        const file = getFile(fileId);
        if (file.uploadId !== uploadId || file.status !== 'uploading') {
            throw new Error(`no live multipart session ${uploadId}`);
        }
        return file;
    };

    const createFile = (
        engine: ServerFile['engine'],
        input: {
            name: string;
            sizeBytes: number;
            mimeType?: string;
            batchId?: string;
        }
    ): ServerFile => {
        const file: ServerFile = {
            fileId: nextId('file'),
            name: input.name,
            size: input.sizeBytes,
            mimeType: input.mimeType,
            batchId: input.batchId,
            engine,
            status: 'uploading',
            parts: new Map(),
        };
        files.push(file);
        byId.set(file.fileId, file);
        return file;
    };

    // The signature changes on every presign, so an expired URL and its
    // replacement are distinguishable.
    const singleUrl = (fileId: string) =>
        `https://s3.test/single/${fileId}?sig=${++seq}`;
    const partUrl = (fileId: string, partNumber: number) =>
        `https://s3.test/part/${fileId}/${partNumber}?sig=${++seq}`;

    const commitToVault = (file: ServerFile) => {
        file.status = 'confirmed';
        vault.push({ name: file.name, size: file.size });
    };

    const api: UploadApi = {
        async upload(input) {
            await call('upload');
            const file = createFile('single', input);
            return { fileId: file.fileId, uploadUrl: singleUrl(file.fileId) };
        },
        async confirmUpload({ fileId }) {
            requireIds('confirmUpload', { fileId });
            await call('confirmUpload');
            const file = getFile(fileId);
            if (file.status !== 'uploading') {
                throw new Error(`confirm: ${fileId} is ${file.status}`);
            }
            if (file.object?.end !== file.size || file.object.start !== 0) {
                throw new Error(`confirm: S3 has no object for ${fileId}`);
            }
            commitToVault(file);
        },
        abandonUpload({ fileId }) {
            requireIds('abandonUpload', { fileId });
            const file = byId.get(fileId);
            if (file?.status === 'uploading') file.status = 'abandoned';
        },
        async multipartInit(input) {
            await call('multipartInit');
            const file = createFile('multipart', input);
            file.uploadId = nextId('upload');
            file.chunkSize = chunkSize;
            file.totalParts = Math.ceil(input.sizeBytes / chunkSize);
            return {
                fileId: file.fileId,
                uploadId: file.uploadId,
                chunkSize,
                partUrls: Array.from({ length: file.totalParts }, (_, i) =>
                    partUrl(file.fileId, i + 1)
                ),
            };
        },
        async multipartListParts({ fileId, uploadId }) {
            requireIds('multipartListParts', { fileId, uploadId });
            await call('multipartListParts');
            const file = getSession(fileId, uploadId);
            return {
                parts: [...file.parts].map(([partNumber, { etag }]) => ({
                    partNumber,
                    etag,
                })),
            };
        },
        async multipartSignParts({ fileId, uploadId, partNumbers }) {
            requireIds('multipartSignParts', { fileId, uploadId });
            if (partNumbers.length === 0) {
                throw new Error('multipartSignParts: no part numbers');
            }
            await call('multipartSignParts');
            getSession(fileId, uploadId);
            return {
                parts: partNumbers.map((partNumber) => ({
                    partNumber,
                    url: partUrl(fileId, partNumber),
                })),
            };
        },
        async multipartComplete({ fileId, uploadId, parts }) {
            requireIds('multipartComplete', { fileId, uploadId });
            await call('multipartComplete');
            const file = getSession(fileId, uploadId);
            assertAssembles(file, parts);
            commitToVault(file);
        },
        multipartAbort({ fileId, uploadId }) {
            requireIds('multipartAbort', { fileId, uploadId });
            const file = byId.get(fileId);
            if (file?.uploadId === uploadId && file.status === 'uploading') {
                file.status = 'aborted';
                file.parts.clear();
            }
        },
        async createBatch({ name }) {
            await call('createBatch');
            const batch = { batchId: nextId('batch'), name };
            batches.push(batch);
            return { batchId: batch.batchId };
        },
        async findDuplicates({ files: candidates }) {
            await call('findDuplicates');
            return candidates.filter((candidate) =>
                vault.some(
                    (held) =>
                        held.name === candidate.name &&
                        held.size === candidate.size
                )
            );
        },
    };

    const parseUrl = (url: string): { fileId: string; partNumber?: number } => {
        const path = new URL(url).pathname.split('/').filter(Boolean);
        return path[0] === 'part'
            ? { fileId: path[1], partNumber: Number(path[2]) }
            : { fileId: path[1] };
    };

    const settle = (entry: PutEntry, error?: unknown): void => {
        const index = inFlight.indexOf(entry);
        if (index === -1) return;
        inFlight.splice(index, 1);
        if (error !== undefined) {
            entry.reject(error);
            return;
        }
        const file = getFile(entry.fileId);
        // S3 rejects a PUT to a session that no longer exists.
        if (file.status !== 'uploading') {
            entry.reject(new UploadHttpError(404));
            return;
        }
        const etag = `"${entry.fileId}-${entry.partNumber ?? 0}-${++seq}"`;
        if (entry.partNumber === undefined) {
            file.object = entry.body;
        } else {
            file.parts.set(entry.partNumber, { etag, range: entry.body });
        }
        const size = entry.body.end - entry.body.start;
        entry.onProgress?.(size, size);
        entry.resolve({ etag });
    };

    const put: typeof xhrPut = (url, body, { onProgress, signal }) =>
        new Promise((resolve, reject) => {
            const target = parseUrl(url);
            const range = rangeOf(body);
            const entry: PutEntry = {
                url,
                ...target,
                fileName: range.fileName,
                body: range,
                onProgress,
                resolve,
                reject,
            };
            puts.push({
                url,
                fileId: entry.fileId,
                fileName: entry.fileName,
                partNumber: entry.partNumber,
            });
            inFlight.push(entry);
            peak = Math.max(peak, inFlight.length);
            const forFile = inFlight.filter(
                (e) => e.fileId === entry.fileId
            ).length;
            peakByFile.set(
                entry.fileId,
                Math.max(peakByFile.get(entry.fileId) ?? 0, forFile)
            );
            // Mirrors xhrPut: an abort rejects the PUT with an AbortError.
            const abort = () =>
                settle(entry, new DOMException('Upload aborted', 'AbortError'));
            if (signal?.aborted) abort();
            signal?.addEventListener('abort', abort, { once: true });
            // A rejection S3 would answer at once (an expired URL, an injected
            // failure) doesn't wait for `completePuts`.
            const rejection = rejectionFor(entry);
            if (rejection !== undefined) {
                queueMicrotask(() => settle(entry, rejection));
            } else if (!isHoldingPuts) {
                queueMicrotask(() => settle(entry));
            }
        });

    const rejectionFor = (entry: PutEntry): unknown => {
        if (expired.some((isExpired) => isExpired(entry.url))) {
            return new UploadHttpError(403);
        }
        const failure = putFailures.find(
            (rule) => rule.times > 0 && rule.where(entry)
        );
        if (!failure) return undefined;
        failure.times--;
        return failure.error;
    };

    const toPublic = ({ url, fileId, fileName, partNumber }: PutEntry) => ({
        url,
        fileId,
        fileName,
        partNumber,
    });

    return {
        api,
        put,
        files,
        filesNamed: (name) => files.filter((file) => file.name === name),
        batches,
        puts,
        putsFor: (partNumber) =>
            puts.filter((put) => put.partNumber === partNumber),
        inFlight: () => inFlight.map(toPublic),
        peakInFlight: () => peak,
        peakInFlightFor: (fileId) => peakByFile.get(fileId) ?? 0,
        addToVault: (...held) => vault.push(...held),
        holdPuts: () => {
            isHoldingPuts = true;
        },
        releasePuts: () => {
            isHoldingPuts = false;
            [...inFlight].forEach((entry) => settle(entry));
        },
        completePuts: (where = () => true) => {
            const matching = inFlight.filter(where);
            matching.forEach((entry) => settle(entry));
            return matching.length;
        },
        failPut: (where, error) => {
            inFlight.filter(where).forEach((entry) => settle(entry, error));
        },
        reportProgress: (where, loaded) => {
            for (const entry of inFlight.filter(where)) {
                entry.onProgress?.(loaded, entry.body.end - entry.body.start);
            }
        },
        failNextPuts: (where, error, times = 1) => {
            putFailures.push({ where, error, times });
        },
        expireUrls: (where) => {
            expired.push(where);
        },
        failNext: (method, error, { skip = 0 } = {}) => {
            callFailures.set(method, [
                ...(callFailures.get(method) ?? []),
                { error, skip },
            ]);
        },
        holdNext: (method) => {
            const gate = deferred();
            callHolds.set(method, [...(callHolds.get(method) ?? []), gate]);
            return gate;
        },
    };
}

/**
 * S3's CompleteMultipartUpload contract: every part once, in order, each with
 * the ETag S3 issued for it — and here also that the parts tile the file, so a
 * wrong byte range can't pass.
 */
function assertAssembles(file: ServerFile, parts: CompletedPart[]): void {
    const expected = Array.from(
        { length: file.totalParts ?? 0 },
        (_, i) => i + 1
    );
    const numbers = parts.map((part) => part.partNumber);
    if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
        throw new Error(`complete: parts ${numbers} != ${expected}`);
    }
    let offset = 0;
    for (const part of parts) {
        const held = file.parts.get(part.partNumber);
        if (!held || held.etag !== part.etag) {
            throw new Error(`complete: bad ETag for part ${part.partNumber}`);
        }
        if (held.range.fileName !== file.name || held.range.start !== offset) {
            throw new Error(`complete: part ${part.partNumber} out of place`);
        }
        offset = held.range.end;
    }
    if (offset !== file.size) {
        throw new Error(`complete: parts cover ${offset} of ${file.size}`);
    }
}

export interface QueueHarness {
    queue: UploadQueue;
    backend: FakeUploadBackend;
    /** Adds the files and clicks Upload; resolves when the wave drains. */
    upload(...files: File[]): Promise<void>;
    rows(): UploadRow[];
    /** The one row with this name; throws if there isn't exactly one. */
    row(name: string): UploadRow;
    setOnline(isOnline: boolean): void;
    /** Every `isUploading` value the engine reported, in order. */
    uploadingStates: boolean[];
    notices: { level: 'info' | 'error'; message: string }[];
    drainedWaves(): number;
}

/**
 * A real upload queue over the fake backend, real IndexedDB-backed resume
 * records (on `fake-indexeddb`; reset with `resetUploadStore`), and rows kept
 * in a plain array.
 *
 * Row writes are visible to the queue at once by default. `commit:
 * 'next-task'` makes them behave like React state instead: the queue reads
 * the rows as last committed, and a write commits a task later, the way a
 * `setState` waits for the next render.
 */
export function createQueueHarness({
    backend = createFakeUploadBackend(),
    commit = 'immediate',
    ...overrides
}: Partial<UploadQueueDeps> & {
    backend?: FakeUploadBackend;
    commit?: 'immediate' | 'next-task';
} = {}): QueueHarness {
    let rows: UploadRow[] = [];
    let committed: UploadRow[] = [];
    let isCommitScheduled = false;
    let isOnline = true;
    let drained = 0;
    const uploadingStates: boolean[] = [];
    const notices: QueueHarness['notices'] = [];

    const queue = createUploadQueue({
        api: backend.api,
        store: { putUpload, addCompletedPart, deleteUpload, listUploads },
        put: backend.put,
        s3Budget: createSemaphore(S3_CONNECTION_BUDGET),
        rows: {
            get: () => committed,
            set: (update) => {
                rows = update(rows);
                if (commit === 'immediate') {
                    committed = rows;
                } else if (!isCommitScheduled) {
                    isCommitScheduled = true;
                    setTimeout(() => {
                        isCommitScheduled = false;
                        committed = rows;
                    }, 0);
                }
            },
        },
        setIsUploading: (value) => uploadingStates.push(value),
        onWaveDrained: () => {
            drained++;
        },
        notify: {
            info: (message) => notices.push({ level: 'info', message }),
            error: (message) => notices.push({ level: 'error', message }),
        },
        reacquireFile: async () => null,
        isOnline: () => isOnline,
        isFileSystemAccessSupported: () => false,
        ...overrides,
    });

    return {
        queue,
        backend,
        upload: async (...files) => {
            await queue.addFiles(picked(...files));
            await queue.startUpload();
        },
        rows: () => rows,
        row: (name) => {
            const matching = rows.filter((row) => row.name === name);
            if (matching.length !== 1) {
                throw new Error(`${matching.length} rows named ${name}`);
            }
            return matching[0];
        },
        setOnline: (value) => {
            isOnline = value;
        },
        uploadingStates,
        notices,
        drainedWaves: () => drained,
    };
}
