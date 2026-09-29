import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushMicrotasks } from '@nexus/async/testing';
import { DOMAIN_ERROR_CODES } from '@/lib/errors/codes';
import { UploadHttpError } from '@/lib/http/xhr';
import { makeClientError } from '@/lib/trpc/test-fixtures';
import {
    MAX_CONCURRENT_CHUNKS,
    MAX_CONCURRENT_FILES,
    MAX_FILES_PER_VAULT_LOOKUP,
} from './limits';
import {
    createFakeUploadBackend,
    createQueueHarness,
    FAKE_CHUNK_SIZE,
    fakeFile,
    MULTIPART_PARTS,
    MULTIPART_SIZE,
    picked,
    resetUploadStore,
    type FakeUploadBackend,
    type QueueHarness,
} from './testing';
import { listUploads, putUpload, type ResumableUpload } from './uploadStore';

beforeEach(resetUploadStore);

const smallFiles = (count: number) =>
    Array.from({ length: count }, (_, i) => fakeFile(`f${i}.jpg`, 1000));

const statusOf = (harness: QueueHarness) =>
    Object.fromEntries(harness.rows().map((row) => [row.name, row.status]));

/** A multipart row's progress once `parts` of its parts have landed. */
const progressAfter = (parts: number) =>
    Math.round((parts / MULTIPART_PARTS) * 100);

const quotaError = () =>
    makeClientError({
        code: 'FORBIDDEN',
        domainCode: DOMAIN_ERROR_CODES.QUOTA_EXCEEDED,
        message: 'Storage quota exceeded',
    });

// What an interrupted upload below has left: parts 1 and 2 in S3.
const PARTS_DONE = 2;
const partsLeftInFlight = Math.min(
    MAX_CONCURRENT_CHUNKS,
    MULTIPART_PARTS - PARTS_DONE
);

/**
 * A multipart upload that got `PARTS_DONE` parts into S3 before its tab died:
 * the server session and the IndexedDB resume record are what's left.
 */
async function interruptedUpload(
    backend: FakeUploadBackend,
    file: File,
    handle?: FileSystemFileHandle
) {
    const firstTab = createQueueHarness({ backend });
    backend.holdPuts();
    await firstTab.queue.addFiles([{ file, handle }]);
    const wave = firstTab.queue.startUpload();
    await vi.waitFor(() =>
        expect(backend.inFlight()).toHaveLength(MAX_CONCURRENT_CHUNKS)
    );
    backend.completePuts((put) => put.partNumber! <= PARTS_DONE);
    await vi.waitFor(async () =>
        expect(
            (await listUploads()).find((record) => record.name === file.name)
                ?.completedParts
        ).toHaveLength(PARTS_DONE)
    );
    // The tab closes: every PUT still open dies with it.
    backend.failPut(() => true, new DOMException('gone', 'AbortError'));
    await wave;
    backend.releasePuts();
    return backend.filesNamed(file.name)[0];
}

describe('adding files', () => {
    it('shows new rows at once as checking, then pending when the vault has no match', async () => {
        const harness = createQueueHarness();
        const gate = harness.backend.holdNext('findDuplicates');

        const added = harness.queue.addFiles(picked(fakeFile('a.jpg', 10)));
        await vi.waitFor(() =>
            expect(statusOf(harness)).toEqual({ 'a.jpg': 'checking' })
        );

        gate.resolve();
        await added;
        expect(harness.row('a.jpg')).toMatchObject({
            status: 'pending',
            isDuplicate: false,
        });
    });

    it("a gesture's vault check settles only its own rows", async () => {
        const harness = createQueueHarness();
        await harness.upload(fakeFile('done.jpg', 10));
        const firstCheck = harness.backend.holdNext('findDuplicates');
        const slow = harness.queue.addFiles(picked(fakeFile('slow.jpg', 10)));
        await vi.waitFor(() => expect(harness.rows()).toHaveLength(2));

        await harness.queue.addFiles(picked(fakeFile('fast.jpg', 10)));

        expect(statusOf(harness)).toEqual({
            'done.jpg': 'complete',
            'slow.jpg': 'checking',
            'fast.jpg': 'pending',
        });
        firstCheck.resolve();
        await slow;
        expect(harness.row('slow.jpg').status).toBe('pending');
    });

    it('marks rows whose name and size the vault already holds, and Upload skips them', async () => {
        const harness = createQueueHarness();
        harness.backend.addToVault(
            { name: 'held.jpg', size: 10 },
            { name: 'resized.jpg', size: 99 }
        );

        await harness.upload(
            fakeFile('held.jpg', 10),
            fakeFile('resized.jpg', 10),
            fakeFile('new.jpg', 10)
        );

        expect(statusOf(harness)).toEqual({
            'held.jpg': 'duplicate',
            'resized.jpg': 'complete',
            'new.jpg': 'complete',
        });
        expect(harness.backend.filesNamed('held.jpg')).toEqual([]);
    });

    it('queues everything when the vault check fails', async () => {
        const harness = createQueueHarness();
        harness.backend.addToVault({ name: 'held.jpg', size: 10 });
        harness.backend.failNext('findDuplicates', new Error('timeout'));

        await harness.queue.addFiles(picked(fakeFile('held.jpg', 10)));

        expect(harness.row('held.jpg')).toMatchObject({
            status: 'pending',
            isDuplicate: false,
        });
    });

    it('keeps the answers of vault lookups that succeeded when a later one fails', async () => {
        const harness = createQueueHarness();
        // One lookup past the cap: the first answers, the second fails.
        const files = Array.from(
            { length: MAX_FILES_PER_VAULT_LOOKUP + 1 },
            (_, i) => fakeFile(`f${i}.jpg`, 10)
        );
        const last = files.at(-1)!.name;
        harness.backend.addToVault(
            { name: 'f0.jpg', size: 10 },
            { name: last, size: 10 }
        );
        harness.backend.failNext('findDuplicates', new Error('timeout'), {
            skip: 1,
        });

        await harness.queue.addFiles(picked(...files));

        expect(harness.row('f0.jpg').status).toBe('duplicate');
        expect(harness.row(last).status).toBe('pending');
    });

    it('Upload anyway sends a duplicate and it stays flagged', async () => {
        const harness = createQueueHarness();
        harness.backend.addToVault({ name: 'held.jpg', size: 10 });
        await harness.queue.addFiles(picked(fakeFile('held.jpg', 10)));

        harness.queue.uploadAnyway(harness.row('held.jpg').id);
        await harness.queue.startUpload();

        expect(harness.row('held.jpg')).toMatchObject({
            status: 'complete',
            isDuplicate: true,
        });
    });

    it('Upload anyway leaves a row that is not a duplicate alone', async () => {
        const harness = createQueueHarness();
        const gate = harness.backend.holdNext('findDuplicates');
        const added = harness.queue.addFiles(picked(fakeFile('a.jpg', 10)));
        await vi.waitFor(() => expect(harness.rows()).toHaveLength(1));

        harness.queue.uploadAnyway(harness.row('a.jpg').id);

        expect(harness.row('a.jpg').status).toBe('checking');
        gate.resolve();
        await added;
    });

    it('Upload all anyway releases every duplicate and nothing else', async () => {
        const harness = createQueueHarness();
        harness.backend.addToVault(
            { name: 'a.jpg', size: 10 },
            { name: 'b.jpg', size: 10 }
        );
        await harness.upload(
            fakeFile('a.jpg', 10),
            fakeFile('b.jpg', 10),
            fakeFile('c.jpg', 10)
        );

        harness.queue.uploadAllAnyway();

        expect(statusOf(harness)).toEqual({
            'a.jpg': 'pending',
            'b.jpg': 'pending',
            'c.jpg': 'complete',
        });
    });
});

describe('the Upload click', () => {
    it('puts every pending file of one folder gesture in one batch named after the folder', async () => {
        const harness = createQueueHarness();

        await harness.queue.addFiles(picked(...smallFiles(3)), 'Wedding');
        await harness.queue.startUpload();

        expect(harness.backend.batches).toEqual([
            { batchId: expect.any(String), name: 'Wedding' },
        ]);
        const [{ batchId }] = harness.backend.batches;
        expect(harness.backend.files.map((file) => file.batchId)).toEqual([
            batchId,
            batchId,
            batchId,
        ]);
    });

    it('leaves the batch unnamed when the rows came from two drops of a same-named folder', async () => {
        const harness = createQueueHarness();

        await harness.queue.addFiles(picked(fakeFile('a.jpg', 10)), 'Shoot');
        await harness.queue.addFiles(picked(fakeFile('b.jpg', 10)), 'Shoot');
        await harness.queue.startUpload();

        expect(harness.backend.batches).toEqual([
            { batchId: expect.any(String), name: undefined },
        ]);
    });

    it('uploads without a session batch when creating one fails', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('createBatch', new Error('db down'));

        await harness.upload(...smallFiles(2));

        expect(statusOf(harness)).toEqual({
            'f0.jpg': 'complete',
            'f1.jpg': 'complete',
        });
        expect(harness.backend.files.map((file) => file.batchId)).toEqual([
            undefined,
            undefined,
        ]);
    });

    it('a second click while the batch is being created uploads nothing twice', async () => {
        const harness = createQueueHarness();
        await harness.queue.addFiles(picked(...smallFiles(2)));
        const gate = harness.backend.holdNext('createBatch');

        const first = harness.queue.startUpload();
        // Claimed before the batch round trip, so they leave the Upload
        // button's pending count at once.
        expect(statusOf(harness)).toEqual({
            'f0.jpg': 'queued',
            'f1.jpg': 'queued',
        });
        const second = harness.queue.startUpload();
        gate.resolve();
        await Promise.all([first, second]);

        expect(harness.backend.batches).toHaveLength(1);
        expect(harness.backend.files.map((file) => file.name)).toEqual([
            'f0.jpg',
            'f1.jpg',
        ]);
    });

    it('a click with nothing pending does nothing', async () => {
        const harness = createQueueHarness();
        harness.backend.addToVault({ name: 'held.jpg', size: 10 });
        await harness.queue.addFiles(picked(fakeFile('held.jpg', 10)));

        await harness.queue.startUpload();

        expect(harness.backend.batches).toEqual([]);
        expect(harness.uploadingStates).toEqual([]);
    });

    it('every file joins the click batch even before its row writes are visible', async () => {
        // As in React, where a row write lands on the next render: the batch
        // id has to travel with the queued item, not be read back off the row.
        const harness = createQueueHarness({ commit: 'next-task' });
        await harness.queue.addFiles(
            picked(fakeFile('a.jpg', 10), fakeFile('clip.mov', MULTIPART_SIZE))
        );
        // Let the added rows commit, as a render would before the click.
        await flushMicrotasks();

        await harness.queue.startUpload();

        const [{ batchId }] = harness.backend.batches;
        expect(
            Object.fromEntries(
                harness.backend.files.map((file) => [file.name, file.batchId])
            )
        ).toEqual({ 'a.jpg': batchId, 'clip.mov': batchId });
    });

    it(`starts files in the order they were added, ${MAX_CONCURRENT_FILES} at a time`, async () => {
        const harness = createQueueHarness();
        const files = smallFiles(MAX_CONCURRENT_FILES + 2);
        const names = files.map((file) => file.name);
        harness.backend.holdPuts();
        await harness.queue.addFiles(picked(...files));
        const wave = harness.queue.startUpload();

        await vi.waitFor(() =>
            expect(
                harness.backend.inFlight().map((put) => put.fileName)
            ).toEqual(names.slice(0, MAX_CONCURRENT_FILES))
        );
        harness.backend.completePuts((put) => put.fileName === names[0]);
        await vi.waitFor(() =>
            expect(harness.backend.inFlight().at(-1)?.fileName).toBe(
                names[MAX_CONCURRENT_FILES]
            )
        );
        harness.backend.releasePuts();
        await wave;

        expect(harness.backend.peakInFlight()).toBe(MAX_CONCURRENT_FILES);
        expect(harness.backend.puts.map((put) => put.fileName)).toEqual(names);
    });

    it('reports uploading for the whole wave and refreshes the file list once', async () => {
        const harness = createQueueHarness();

        await harness.upload(...smallFiles(3));

        expect(harness.uploadingStates).toEqual([true, false]);
        expect(harness.drainedWaves()).toBe(1);
    });

    it('a quota rejection fails its row and hands the unstarted rows back to the Upload button', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('upload', quotaError());

        await harness.upload(...smallFiles(MAX_CONCURRENT_FILES + 2));

        const [rejected, ...rest] = harness.rows();
        expect(rejected).toMatchObject({
            status: 'error',
            error: 'Storage quota exceeded',
        });
        // The files already in flight finish; the two still queued are
        // released without reaching the server.
        expect(rest.map((row) => row.status)).toEqual([
            ...Array(MAX_CONCURRENT_FILES - 1).fill('complete'),
            'pending',
            'pending',
        ]);
        const released = rest.slice(-2).map((row) => row.name);
        expect(
            harness.backend.files.filter((file) => released.includes(file.name))
        ).toEqual([]);
    });

    it('any other failure leaves the rest of the wave running', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.fileName === 'f0.jpg',
            new UploadHttpError(500)
        );

        await harness.upload(...smallFiles(MAX_CONCURRENT_FILES + 2));

        expect(harness.row('f0.jpg').status).toBe('error');
        expect(
            harness.rows().filter((row) => row.status === 'complete')
        ).toHaveLength(MAX_CONCURRENT_FILES + 1);
    });
});

describe('Retry', () => {
    it('releases the failed single-part attempt and rejoins the original batch', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('confirmUpload', new Error('db down'));
        await harness.upload(fakeFile('a.jpg', 10));
        const [{ batchId }] = harness.backend.batches;

        await harness.queue.retryFile(harness.row('a.jpg').id);

        expect(harness.row('a.jpg')).toMatchObject({
            status: 'complete',
            error: undefined,
        });
        expect(harness.backend.filesNamed('a.jpg')).toMatchObject([
            { status: 'abandoned', batchId },
            { status: 'confirmed', batchId },
        ]);
        expect(harness.backend.batches).toHaveLength(1);
    });

    it('a row retried while the pool is full waits as queued, out of the Upload count', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.fileName === 'failed.jpg',
            new UploadHttpError(500)
        );
        await harness.upload(fakeFile('failed.jpg', 10));
        harness.backend.holdPuts();
        await harness.queue.addFiles(
            picked(...smallFiles(MAX_CONCURRENT_FILES))
        );
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_FILES
            )
        );

        const retried = harness.queue.retryFile(harness.row('failed.jpg').id);

        expect(harness.row('failed.jpg')).toMatchObject({
            status: 'queued',
            error: undefined,
        });
        harness.backend.releasePuts();
        await Promise.all([wave, retried]);
        expect(harness.row('failed.jpg').status).toBe('complete');
    });

    it('keeps reporting uploading until every driver is done', async () => {
        const backend = createFakeUploadBackend();
        const file = fakeFile('resume.mov', MULTIPART_SIZE);
        await interruptedUpload(backend, file, {} as FileSystemFileHandle);
        const harness = createQueueHarness({
            backend,
            isFileSystemAccessSupported: () => true,
            reacquireFile: async () => file,
        });
        await harness.queue.hydrate();
        backend.holdPuts();
        await harness.queue.addFiles(picked(fakeFile('a.jpg', 10)));
        const wave = harness.queue.startUpload();
        const resume = harness.queue.resumeWithHandle(
            harness.row('resume.mov').id
        );
        await vi.waitFor(() =>
            expect(backend.inFlight()).toHaveLength(partsLeftInFlight + 1)
        );

        backend.completePuts((put) => put.fileName === 'resume.mov');
        await resume;
        expect(harness.uploadingStates.at(-1)).toBe(true);

        backend.releasePuts();
        await wave;
        expect(harness.uploadingStates.at(-1)).toBe(false);
    });
});

describe('connection drops', () => {
    /** Two small uploads held in flight, then the browser goes offline. */
    async function pausedMidWave() {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        await harness.queue.addFiles(picked(...smallFiles(2)));
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(2)
        );
        harness.setOnline(false);
        harness.queue.pauseActive();
        await wave;
        return harness;
    }

    it('going offline pauses the uploads in flight and says so', async () => {
        const harness = await pausedMidWave();

        expect(statusOf(harness)).toEqual({
            'f0.jpg': 'paused',
            'f1.jpg': 'paused',
        });
        expect(harness.notices).toEqual([
            {
                level: 'info',
                message: 'Upload paused — waiting for your connection',
            },
        ]);
    });

    it('coming back online resumes the paused uploads and says so', async () => {
        const harness = await pausedMidWave();

        harness.setOnline(true);
        harness.backend.releasePuts();
        await harness.queue.resumePaused();

        expect(statusOf(harness)).toEqual({
            'f0.jpg': 'complete',
            'f1.jpg': 'complete',
        });
        expect(harness.notices.at(-1)).toEqual({
            level: 'info',
            message: 'Back online — resuming upload',
        });
    });

    it('a resumed single-part upload restarts and releases the attempt it replaces', async () => {
        const harness = await pausedMidWave();

        harness.setOnline(true);
        harness.backend.releasePuts();
        await harness.queue.resumePaused();

        expect(
            harness.backend.filesNamed('f0.jpg').map((file) => file.status)
        ).toEqual(['abandoned', 'confirmed']);
    });

    it('files still queued when the connection drops wait as paused without touching the server', async () => {
        const harness = createQueueHarness();
        const files = smallFiles(MAX_CONCURRENT_FILES + 2);
        harness.backend.holdPuts();
        await harness.queue.addFiles(picked(...files));
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_FILES
            )
        );

        harness.setOnline(false);
        harness.queue.pauseActive();
        await wave;

        expect(Object.values(statusOf(harness))).toEqual(
            Array(files.length).fill('paused')
        );
        expect(harness.backend.files).toHaveLength(MAX_CONCURRENT_FILES);

        harness.setOnline(true);
        harness.backend.releasePuts();
        await harness.queue.resumePaused();
        expect(Object.values(statusOf(harness))).toEqual(
            Array(files.length).fill('complete')
        );
    });

    it('a drop with nothing in flight pauses nothing and says nothing', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.fileName === 'failed.jpg',
            new UploadHttpError(500)
        );
        // Settled rows still hold their attempt's abort controller.
        await harness.upload(
            fakeFile('done.jpg', 10),
            fakeFile('failed.jpg', 10)
        );

        harness.setOnline(false);
        harness.queue.pauseActive();
        harness.setOnline(true);
        await harness.queue.resumePaused();

        expect(statusOf(harness)).toEqual({
            'done.jpg': 'complete',
            'failed.jpg': 'error',
        });
        expect(harness.notices).toEqual([]);
    });

    it('a paused multipart upload resumes from the parts S3 already holds', async () => {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        await harness.queue.addFiles(
            picked(fakeFile('clip.mov', MULTIPART_SIZE))
        );
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_CHUNKS
            )
        );
        harness.backend.completePuts((put) => put.partNumber! <= 2);
        await vi.waitFor(() =>
            expect(harness.row('clip.mov').progress).toBe(progressAfter(2))
        );

        harness.setOnline(false);
        harness.queue.pauseActive();
        await wave;
        expect(harness.row('clip.mov').status).toBe('paused');

        harness.setOnline(true);
        harness.backend.releasePuts();
        await harness.queue.resumePaused();

        expect(harness.backend.filesNamed('clip.mov')).toMatchObject([
            { status: 'confirmed' },
        ]);
        expect(harness.backend.putsFor(1)).toHaveLength(1);
        expect(harness.backend.putsFor(2)).toHaveLength(1);
    });
});

describe('resuming after a reload', () => {
    const record = (
        overrides: Partial<ResumableUpload> = {}
    ): ResumableUpload => ({
        fileId: 'file-1',
        uploadId: 'upload-1',
        name: 'clip.mov',
        size: MULTIPART_SIZE,
        lastModified: 1,
        mimeType: '',
        chunkSize: FAKE_CHUNK_SIZE,
        totalParts: MULTIPART_PARTS,
        completedParts: [
            { partNumber: 1, etag: 'a' },
            { partNumber: 2, etag: 'b' },
        ],
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    });

    it('lists an interrupted upload as a resumable row at its last progress', async () => {
        await putUpload(record());
        const harness = createQueueHarness();

        await harness.queue.hydrate();

        expect(harness.row('clip.mov')).toMatchObject({
            id: 'file-1',
            status: 'resumable',
            progress: progressAfter(2),
            file: null,
            isQuickResumable: false,
        });
    });

    it('offers one-click resume only for a persisted handle on a browser that can reopen it', async () => {
        await putUpload(record({ fileHandle: {} as FileSystemFileHandle }));
        await putUpload(record({ fileId: 'file-2', name: 'no-handle.mov' }));
        const harness = createQueueHarness({
            isFileSystemAccessSupported: () => true,
        });

        await harness.queue.hydrate();

        expect(harness.row('clip.mov').isQuickResumable).toBe(true);
        expect(harness.row('no-handle.mov').isQuickResumable).toBe(false);
    });

    it('skips records with every part done, and adds nothing on a second pass', async () => {
        await putUpload(record());
        await putUpload(
            record({
                fileId: 'file-2',
                name: 'done.mov',
                totalParts: 2,
            })
        );
        const harness = createQueueHarness();

        await harness.queue.hydrate();
        await harness.queue.hydrate();

        expect(harness.rows().map((row) => row.name)).toEqual(['clip.mov']);
    });

    it('re-adding the file resumes the original session and batch without the vault check', async () => {
        const backend = createFakeUploadBackend();
        const file = fakeFile('clip.mov', MULTIPART_SIZE);
        const session = await interruptedUpload(backend, file);
        // A vault match must not turn a resume into a duplicate.
        backend.addToVault(
            { name: 'clip.mov', size: MULTIPART_SIZE },
            { name: 'other.jpg', size: 10 }
        );
        const harness = createQueueHarness({ backend });
        // An unrelated row listed first: the re-add must find its own.
        await harness.queue.addFiles(picked(fakeFile('other.jpg', 10)));
        await harness.queue.hydrate();

        await harness.queue.addFiles(picked(file));
        expect(harness.row('clip.mov')).toMatchObject({
            id: session.fileId,
            status: 'pending',
            progress: progressAfter(PARTS_DONE),
        });
        await harness.queue.startUpload();

        expect(harness.row('clip.mov').status).toBe('complete');
        expect(session.status).toBe('confirmed');
        expect(backend.batches).toHaveLength(1);
        expect(backend.putsFor(1)).toHaveLength(1);
        expect(backend.putsFor(2)).toHaveLength(1);
        expect(await listUploads()).toEqual([]);
    });

    it('re-adding the file resumes it even before the resumable row is listed', async () => {
        const backend = createFakeUploadBackend();
        const file = fakeFile('clip.mov', MULTIPART_SIZE);
        const session = await interruptedUpload(backend, file);
        const harness = createQueueHarness({ backend });

        await harness.upload(file);

        expect(harness.row('clip.mov')).toMatchObject({
            id: session.fileId,
            status: 'complete',
        });
        expect(backend.files).toEqual([session]);
    });

    it('a file with the same name but a different modified time starts a new upload', async () => {
        const backend = createFakeUploadBackend();
        await interruptedUpload(backend, fakeFile('clip.mov', MULTIPART_SIZE));
        const harness = createQueueHarness({ backend });

        await harness.upload(
            fakeFile('clip.mov', MULTIPART_SIZE, { lastModified: 2 })
        );

        expect(
            backend.filesNamed('clip.mov').map((file) => file.status)
        ).toEqual(['uploading', 'confirmed']);
    });

    it('one-click resume reopens the handle, finishes the upload and refreshes the file list', async () => {
        const backend = createFakeUploadBackend();
        const file = fakeFile('clip.mov', MULTIPART_SIZE);
        const session = await interruptedUpload(
            backend,
            file,
            {} as FileSystemFileHandle
        );
        const harness = createQueueHarness({
            backend,
            isFileSystemAccessSupported: () => true,
            reacquireFile: async () => file,
        });
        await harness.queue.hydrate();

        await harness.queue.resumeWithHandle(session.fileId);

        expect(harness.row('clip.mov')).toMatchObject({
            status: 'complete',
            file,
        });
        expect(session.status).toBe('confirmed');
        expect(backend.putsFor(1)).toHaveLength(1);
        expect(harness.drainedWaves()).toBe(1);
    });

    it('Resume all skips a row that has already been resumed', async () => {
        const backend = createFakeUploadBackend();
        const file = fakeFile('clip.mov', MULTIPART_SIZE);
        const session = await interruptedUpload(
            backend,
            file,
            {} as FileSystemFileHandle
        );
        let reopened = 0;
        const harness = createQueueHarness({
            backend,
            isFileSystemAccessSupported: () => true,
            reacquireFile: async () => {
                reopened++;
                return file;
            },
        });
        await harness.queue.hydrate();
        await harness.queue.resumeWithHandle(session.fileId);

        await harness.queue.resumeAllWithHandles();

        expect(reopened).toBe(1);
    });

    it('Resume all resumes the rows one at a time', async () => {
        const backend = createFakeUploadBackend();
        const files = [
            fakeFile('a.mov', MULTIPART_SIZE),
            fakeFile('b.mov', MULTIPART_SIZE),
        ];
        for (const file of files) {
            await interruptedUpload(backend, file, {} as FileSystemFileHandle);
        }
        const harness = createQueueHarness({
            backend,
            isFileSystemAccessSupported: () => true,
            reacquireFile: async (row) =>
                files.find((file) => file.name === row.name) ?? null,
        });
        await harness.queue.hydrate();
        backend.holdPuts();

        const resumed = harness.queue.resumeAllWithHandles();

        await vi.waitFor(() =>
            expect(backend.inFlight()).toHaveLength(partsLeftInFlight)
        );
        // Serial: the second row waits its turn untouched.
        expect(
            harness
                .rows()
                .map((row) => row.status)
                .sort()
        ).toEqual(['resumable', 'uploading']);
        backend.releasePuts();
        await resumed;
        // Each row now carries its reopened bytes (the queue's preview).
        expect(
            Object.fromEntries(
                harness.rows().map((row) => [row.name, [row.status, row.file]])
            )
        ).toEqual({
            'a.mov': ['complete', files[0]],
            'b.mov': ['complete', files[1]],
        });
    });

    it('Resume all reopens only the rows offering one-click resume', async () => {
        await putUpload(record({ fileHandle: {} as FileSystemFileHandle }));
        await putUpload(record({ fileId: 'file-2', name: 'no-handle.mov' }));
        const reopened: string[] = [];
        const harness = createQueueHarness({
            isFileSystemAccessSupported: () => true,
            reacquireFile: async (row) => {
                reopened.push(row.name);
                return null;
            },
        });
        await harness.queue.hydrate();

        await harness.queue.resumeAllWithHandles();

        expect(reopened).toEqual(['clip.mov']);
    });

    it('a handle that no longer opens drops the one-click offer and says to re-add', async () => {
        await putUpload(record({ fileHandle: {} as FileSystemFileHandle }));
        await putUpload(
            record({
                fileId: 'file-2',
                name: 'other.mov',
                fileHandle: {} as FileSystemFileHandle,
            })
        );
        const harness = createQueueHarness({
            isFileSystemAccessSupported: () => true,
            reacquireFile: async () => null,
        });
        await harness.queue.hydrate();

        await harness.queue.resumeAllWithHandles();

        expect(harness.row('clip.mov')).toMatchObject({
            status: 'resumable',
            isQuickResumable: false,
        });
        expect(harness.row('other.mov').isQuickResumable).toBe(false);
        expect(harness.notices).toEqual([
            {
                level: 'error',
                message: "Couldn't reopen the files — re-add them to resume",
            },
        ]);
    });

    it('a single handle that no longer opens says so in the singular', async () => {
        await putUpload(record({ fileHandle: {} as FileSystemFileHandle }));
        const harness = createQueueHarness({
            isFileSystemAccessSupported: () => true,
            reacquireFile: async () => null,
        });
        await harness.queue.hydrate();

        await harness.queue.resumeWithHandle('file-1');

        expect(harness.notices).toEqual([
            {
                level: 'error',
                message: "Couldn't reopen the file — re-add it to resume",
            },
        ]);
    });

    it('Resume all with nothing to reopen says nothing', async () => {
        await putUpload(record());
        const harness = createQueueHarness();
        await harness.queue.hydrate();

        await harness.queue.resumeAllWithHandles();

        expect(harness.notices).toEqual([]);
        expect(harness.uploadingStates).toEqual([]);
    });
});

describe('removing rows', () => {
    it('cancelling a multipart upload in flight aborts the S3 session and forgets the resume record', async () => {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        await harness.queue.addFiles(
            picked(fakeFile('clip.mov', MULTIPART_SIZE))
        );
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_CHUNKS
            )
        );

        harness.queue.dropRow(harness.row('clip.mov').id);
        await wave;

        expect(harness.rows()).toEqual([]);
        expect(harness.backend.filesNamed('clip.mov')).toMatchObject([
            { status: 'aborted' },
        ]);
        await vi.waitFor(async () => expect(await listUploads()).toEqual([]));
    });

    it('a row removed while still queued is never uploaded', async () => {
        const harness = createQueueHarness();
        const files = smallFiles(MAX_CONCURRENT_FILES + 1);
        const queuedName = files.at(-1)!.name;
        harness.backend.holdPuts();
        await harness.queue.addFiles(picked(...files));
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_FILES
            )
        );

        harness.queue.dropRow(harness.row(queuedName).id);
        harness.backend.releasePuts();
        await wave;

        expect(harness.backend.filesNamed(queuedName)).toEqual([]);
        expect(harness.rows().map((row) => row.status)).toEqual(
            Array(MAX_CONCURRENT_FILES).fill('complete')
        );
    });

    it('removing a failed single-part row releases its server file', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(() => true, new UploadHttpError(500));
        await harness.upload(fakeFile('a.jpg', 10));

        harness.queue.dropRow(harness.row('a.jpg').id);

        expect(harness.rows()).toEqual([]);
        expect(harness.backend.filesNamed('a.jpg')).toMatchObject([
            { status: 'abandoned' },
        ]);
    });

    it('Clear all releases single-part attempts but keeps multipart work resumable', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.fileName === 'a.jpg',
            new UploadHttpError(500)
        );
        harness.backend.holdPuts();
        await harness.queue.addFiles(
            picked(fakeFile('a.jpg', 10), fakeFile('clip.mov', MULTIPART_SIZE))
        );
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.row('a.jpg').status).toBe('error')
        );
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_CHUNKS
            )
        );
        // Added after the click, so never started: nothing to abort or release.
        await harness.queue.addFiles(picked(fakeFile('waiting.jpg', 10)));

        harness.queue.clearFiles();
        await wave;

        expect(harness.rows()).toEqual([]);
        expect(harness.backend.filesNamed('a.jpg')).toMatchObject([
            { status: 'abandoned' },
        ]);
        expect(harness.backend.filesNamed('clip.mov')).toMatchObject([
            { status: 'uploading' },
        ]);
        expect(await listUploads()).toMatchObject([{ name: 'clip.mov' }]);
    });
});
