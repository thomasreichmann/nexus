import type { Page } from '@playwright/test';

export interface SeedResumableUploadOptions {
    fileId?: string;
    uploadId?: string;
    name?: string;
    size?: number;
    lastModified?: number;
    mimeType?: string;
    chunkSize?: number;
    totalParts?: number;
    completedCount?: number;
    /** Plain stand-in for a persisted File System Access handle (one-click resume). */
    fileHandle?: { kind: 'file'; name: string };
}

/**
 * Seed a half-finished multipart upload straight into the browser's IndexedDB,
 * as if a prior session had been interrupted. Mirrors the `nexus-uploads` store
 * shape from `lib/upload/uploadStore.ts`, kept in one place so the resume tests
 * don't each hand-roll (and drift on) the open/upgrade/put dance.
 */
export async function seedResumableUpload(
    page: Page,
    options: SeedResumableUploadOptions = {}
): Promise<void> {
    const {
        fileId = '11111111-1111-1111-1111-111111111111',
        uploadId = 'seeded-upload-id',
        name = 'big-shoot.zip',
        size = 1_048_576_000,
        lastModified = 1700000000000,
        mimeType = 'application/zip',
        chunkSize = 104_857_600,
        totalParts = 10,
        completedCount = 5,
        fileHandle,
    } = options;

    const record = {
        fileId,
        uploadId,
        name,
        size,
        lastModified,
        mimeType,
        chunkSize,
        totalParts,
        completedParts: Array.from({ length: completedCount }, (_, i) => ({
            partNumber: i + 1,
            etag: `"part-${i + 1}"`,
        })),
        createdAt: lastModified,
        updatedAt: lastModified,
        ...(fileHandle ? { fileHandle } : {}),
    };

    await page.evaluate(async (seeded) => {
        const open = indexedDB.open('nexus-uploads', 1);
        const db: IDBDatabase = await new Promise((res, rej) => {
            open.onupgradeneeded = () =>
                open.result.createObjectStore('uploads', { keyPath: 'fileId' });
            open.onsuccess = () => res(open.result);
            open.onerror = () => rej(open.error);
        });
        await new Promise<void>((res, rej) => {
            const tx = db.transaction('uploads', 'readwrite');
            tx.objectStore('uploads').put(seeded);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
        db.close();
    }, record);
}
