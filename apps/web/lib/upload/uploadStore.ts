import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Client-side persistence for in-progress multipart uploads, so an upload can
 * resume after a network drop, tab close, or reload instead of restarting from
 * zero. The file's bytes are NOT stored (a 30-80GB shoot would blow past the
 * quota) — only the metadata needed to reconcile with S3 and continue. After a
 * reload the user re-adds the same file; we match it by identity and resume.
 */

const DB_NAME = 'nexus-uploads';
const DB_VERSION = 1;
const STORE = 'uploads';

export interface CompletedPart {
    partNumber: number;
    etag: string;
}

export interface ResumableUpload {
    /** Server file row id — the store key. */
    fileId: string;
    /** S3 multipart upload id, needed for every part operation on resume. */
    uploadId: string;
    // File identity — used to match a re-added file back to this record after a
    // reload, when the in-memory File (and its bytes) are gone.
    name: string;
    size: number;
    lastModified: number;
    mimeType: string;
    chunkSize: number;
    totalParts: number;
    completedParts: CompletedPart[];
    createdAt: number;
    updatedAt: number;
    // Chromium-only: the File System Access handle for zero-touch resume. It's
    // structured-cloneable, so IndexedDB persists it directly — no schema bump.
    // Absent on other browsers and pre-handle records, which fall back to re-add.
    fileHandle?: FileSystemFileHandle;
}

interface UploadDBSchema extends DBSchema {
    uploads: {
        key: string;
        value: ResumableUpload;
    };
}

let dbPromise: Promise<IDBPDatabase<UploadDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<UploadDBSchema>> {
    // Lazily opened so importing this module on the server (SSR of the upload
    // page) never touches IndexedDB, which only exists in the browser.
    if (!dbPromise) {
        dbPromise = openDB<UploadDBSchema>(DB_NAME, DB_VERSION, {
            upgrade(db) {
                db.createObjectStore(STORE, { keyPath: 'fileId' });
            },
        });
    }
    return dbPromise;
}

export async function putUpload(record: ResumableUpload): Promise<void> {
    const db = await getDb();
    await db.put(STORE, record);
}

export async function getUpload(
    fileId: string
): Promise<ResumableUpload | undefined> {
    const db = await getDb();
    return db.get(STORE, fileId);
}

export async function listUploads(): Promise<ResumableUpload[]> {
    const db = await getDb();
    return db.getAll(STORE);
}

export async function deleteUpload(fileId: string): Promise<void> {
    const db = await getDb();
    await db.delete(STORE, fileId);
}

/**
 * Find a persisted upload matching a re-added file's identity. In-progress
 * uploads are few, so a full scan is fine and avoids a composite-key index.
 */
export async function findUploadByIdentity(identity: {
    name: string;
    size: number;
    lastModified: number;
}): Promise<ResumableUpload | undefined> {
    const all = await listUploads();
    return all.find(
        (u) =>
            u.name === identity.name &&
            u.size === identity.size &&
            u.lastModified === identity.lastModified
    );
}

/**
 * Record a completed part. Read-modify-write inside a single readwrite
 * transaction; IndexedDB serializes overlapping-scope transactions, so the
 * concurrent chunk uploads can't lose each other's writes. Dedupes by part
 * number in case a part is re-confirmed (e.g. after a re-presign + retry).
 */
export async function addCompletedPart(
    fileId: string,
    part: CompletedPart
): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(STORE, 'readwrite');
    const record = await tx.store.get(fileId);
    if (record) {
        if (
            !record.completedParts.some((p) => p.partNumber === part.partNumber)
        ) {
            record.completedParts.push(part);
        }
        record.updatedAt = Date.now();
        await tx.store.put(record);
    }
    await tx.done;
}

/**
 * Reset the cached connection — test-only. Lets a suite delete the database
 * and reopen a clean one between cases.
 */
export async function resetUploadStoreForTests(): Promise<void> {
    if (dbPromise) {
        (await dbPromise).close();
        dbPromise = null;
    }
}
