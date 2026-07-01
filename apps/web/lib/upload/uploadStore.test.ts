import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
    putUpload,
    getUpload,
    listUploads,
    deleteUpload,
    findUploadByIdentity,
    addCompletedPart,
    resetUploadStoreForTests,
    type ResumableUpload,
} from './uploadStore';

function makeRecord(overrides: Partial<ResumableUpload> = {}): ResumableUpload {
    return {
        fileId: 'file-1',
        uploadId: 'upload-1',
        name: 'shoot.zip',
        size: 1000,
        lastModified: 123,
        mimeType: 'application/zip',
        chunkSize: 100,
        totalParts: 10,
        completedParts: [],
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

describe('uploadStore', () => {
    beforeEach(async () => {
        await resetUploadStoreForTests();
        // Fresh in-memory IndexedDB per test.
        globalThis.indexedDB = new IDBFactory();
    });

    it('puts and gets a record', async () => {
        const record = makeRecord();
        await putUpload(record);

        expect(await getUpload('file-1')).toEqual(record);
    });

    it('returns undefined for a missing record', async () => {
        expect(await getUpload('nope')).toBeUndefined();
    });

    it('round-trips a persisted file handle', async () => {
        // A real FileSystemFileHandle is structured-cloneable in Chromium; here a
        // plain stand-in proves the optional field survives put/get unchanged.
        const fileHandle = {
            kind: 'file',
            name: 'shoot.zip',
        } as unknown as FileSystemFileHandle;
        await putUpload(makeRecord({ fileHandle }));

        expect((await getUpload('file-1'))?.fileHandle).toEqual(fileHandle);
    });

    it('lists all records', async () => {
        await putUpload(makeRecord({ fileId: 'a' }));
        await putUpload(makeRecord({ fileId: 'b' }));

        const all = await listUploads();

        expect(all.map((r) => r.fileId).sort()).toEqual(['a', 'b']);
    });

    it('deletes a record', async () => {
        await putUpload(makeRecord());
        await deleteUpload('file-1');

        expect(await getUpload('file-1')).toBeUndefined();
    });

    describe('findUploadByIdentity', () => {
        it('matches on name + size + lastModified', async () => {
            await putUpload(
                makeRecord({
                    fileId: 'a',
                    name: 'a.zip',
                    size: 1,
                    lastModified: 1,
                })
            );
            await putUpload(
                makeRecord({
                    fileId: 'b',
                    name: 'b.zip',
                    size: 2,
                    lastModified: 2,
                })
            );

            const found = await findUploadByIdentity({
                name: 'b.zip',
                size: 2,
                lastModified: 2,
            });

            expect(found?.fileId).toBe('b');
        });

        it('returns undefined when size differs (same name)', async () => {
            await putUpload(
                makeRecord({ name: 'a.zip', size: 1, lastModified: 1 })
            );

            const found = await findUploadByIdentity({
                name: 'a.zip',
                size: 999,
                lastModified: 1,
            });

            expect(found).toBeUndefined();
        });
    });

    describe('addCompletedPart', () => {
        it('appends a part and bumps updatedAt', async () => {
            await putUpload(makeRecord({ updatedAt: 1 }));

            await addCompletedPart('file-1', { partNumber: 1, etag: '"a"' });

            const record = await getUpload('file-1');
            expect(record?.completedParts).toEqual([
                { partNumber: 1, etag: '"a"' },
            ]);
            expect(record?.updatedAt).toBeGreaterThan(1);
        });

        it('dedupes by part number', async () => {
            await putUpload(
                makeRecord({
                    completedParts: [{ partNumber: 1, etag: '"a"' }],
                })
            );

            await addCompletedPart('file-1', { partNumber: 1, etag: '"a"' });

            const record = await getUpload('file-1');
            expect(record?.completedParts).toHaveLength(1);
        });

        it('persists every part under concurrent writes', async () => {
            await putUpload(makeRecord());

            await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    addCompletedPart('file-1', {
                        partNumber: i + 1,
                        etag: `"${i + 1}"`,
                    })
                )
            );

            const record = await getUpload('file-1');
            expect(record?.completedParts).toHaveLength(10);
            expect(
                record?.completedParts
                    .map((p) => p.partNumber)
                    .sort((a, b) => a - b)
            ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        });

        it('no-ops for a missing record', async () => {
            await expect(
                addCompletedPart('ghost', { partNumber: 1, etag: '"a"' })
            ).resolves.toBeUndefined();
        });
    });
});
