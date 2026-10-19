import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadHttpError, UploadNetworkError } from '@/lib/http/xhr';
import { PostHogEvent } from '@/lib/posthog/events';
import {
    MAX_CHUNK_RETRIES,
    MAX_CONCURRENT_CHUNKS,
    MULTIPART_THRESHOLD,
    S3_CONNECTION_BUDGET,
} from './limits';
import {
    createQueueHarness,
    fakeFile,
    MULTIPART_PARTS,
    MULTIPART_SIZE,
    picked,
    resetUploadStore,
} from './testing';
import { listUploads } from './uploadStore';

// PostHog is where the upload funnel is read, so its events are an outcome.
const events = vi.hoisted(
    () => [] as { event: string; props: Record<string, unknown> }[]
);
vi.mock('@/lib/posthog/client', () => ({
    captureEvent: (event: string, props: Record<string, unknown>) =>
        events.push({ event, props }),
}));

beforeEach(async () => {
    await resetUploadStore();
    events.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

const firstParts = Array.from(
    { length: MAX_CONCURRENT_CHUNKS },
    (_, i) => i + 1
);

describe('engine choice', () => {
    it('sends a file at the multipart threshold through multipart and one byte under it as a single PUT', async () => {
        const harness = createQueueHarness();

        await harness.upload(
            fakeFile('at.mov', MULTIPART_THRESHOLD),
            fakeFile('under.mov', MULTIPART_THRESHOLD - 1)
        );

        expect(harness.backend.filesNamed('at.mov')[0].engine).toBe(
            'multipart'
        );
        expect(harness.backend.filesNamed('under.mov')[0].engine).toBe(
            'single'
        );
    });
});

describe('file metadata', () => {
    it("sends the browser's MIME type, and none when the browser has none", async () => {
        const harness = createQueueHarness();

        await harness.upload(
            fakeFile('a.jpg', 10, { type: 'image/jpeg' }),
            fakeFile('b.cr3', 10),
            fakeFile('c.mov', MULTIPART_SIZE, { type: 'video/quicktime' }),
            fakeFile('d.braw', MULTIPART_SIZE)
        );

        expect(
            Object.fromEntries(
                harness.backend.files.map((file) => [file.name, file.mimeType])
            )
        ).toStrictEqual({
            'a.jpg': 'image/jpeg',
            'b.cr3': undefined,
            'c.mov': 'video/quicktime',
            'd.braw': undefined,
        });
    });
});

describe('single-part upload', () => {
    it('shows the PUT progress on the row', async () => {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        await harness.queue.addFiles(picked(fakeFile('a.jpg', 1000)));
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(1)
        );

        harness.backend.reportProgress(() => true, 256);

        expect(harness.row('a.jpg').progress).toBe(26);
        harness.backend.releasePuts();
        await wave;
    });

    it('confirms the file once S3 holds it and marks the row complete', async () => {
        const harness = createQueueHarness();

        await harness.upload(fakeFile('a.jpg', 1000));

        expect(harness.backend.filesNamed('a.jpg')).toMatchObject([
            { status: 'confirmed' },
        ]);
        expect(harness.row('a.jpg')).toMatchObject({
            status: 'complete',
            progress: 100,
        });
    });

    it('restarts once on an expired URL, releasing the dead attempt', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(() => true, new UploadHttpError(403));

        await harness.upload(fakeFile('a.jpg', 1000));

        expect(harness.row('a.jpg').status).toBe('complete');
        expect(
            harness.backend.filesNamed('a.jpg').map((file) => file.status)
        ).toEqual(['abandoned', 'confirmed']);
    });

    it('fails the row when the fresh URL is refused too', async () => {
        const harness = createQueueHarness();
        harness.backend.expireUrls(() => true);

        await harness.upload(fakeFile('a.jpg', 1000));

        expect(harness.row('a.jpg')).toMatchObject({
            status: 'error',
            error: 'Upload failed — try again',
        });
        expect(harness.backend.filesNamed('a.jpg')).toHaveLength(2);
    });

    it('fails the row when confirm is rejected, though S3 has the bytes', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('confirmUpload', new Error('db down'));

        await harness.upload(fakeFile('a.jpg', 1000));

        expect(harness.row('a.jpg')).toMatchObject({
            status: 'error',
            error: 'Upload failed',
        });
    });

    it('fails the row on a dropped connection while online', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(() => true, new UploadNetworkError());

        await harness.upload(fakeFile('a.jpg', 1000));

        expect(harness.row('a.jpg')).toMatchObject({
            status: 'error',
            error: 'Connection problem — check your network and retry',
        });
    });

    it('pauses the row instead when the browser is offline', async () => {
        const harness = createQueueHarness();
        await harness.queue.addFiles(picked(fakeFile('a.jpg', 1000)));
        harness.backend.holdPuts();
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(1)
        );

        harness.setOnline(false);
        harness.backend.failPut(() => true, new UploadNetworkError());
        await wave;

        expect(harness.row('a.jpg').status).toBe('paused');
    });

    // S3 answered, so the connection isn't what failed, and a reconnect
    // wouldn't fix it: pausing would leave the row waiting for nothing.
    it('fails the row on a server error even when the browser is offline', async () => {
        const harness = createQueueHarness();
        await harness.queue.addFiles(picked(fakeFile('a.jpg', 1000)));
        harness.backend.holdPuts();
        const wave = harness.queue.startUpload();
        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(1)
        );

        harness.setOnline(false);
        harness.backend.failPut(() => true, new UploadHttpError(500));
        await wave;

        expect(harness.row('a.jpg')).toMatchObject({
            status: 'error',
            error: 'Upload failed — try again',
        });
    });
});

describe('multipart upload', () => {
    it('uploads every part and completes with the parts assembled in order', async () => {
        const harness = createQueueHarness();

        await harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));

        // The backend's complete refuses a gap, a stale ETag or a wrong byte
        // range, so `confirmed` means the object assembled correctly.
        const [file] = harness.backend.filesNamed('clip.mov');
        expect(file).toMatchObject({
            status: 'confirmed',
            totalParts: MULTIPART_PARTS,
        });
        expect(harness.row('clip.mov')).toMatchObject({
            status: 'complete',
            progress: 100,
        });
        expect(await listUploads()).toEqual([]);
    });

    it('persists a resume record at init and each finished part as it lands', async () => {
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

        await vi.waitFor(async () =>
            expect(await listUploads()).toMatchObject([
                {
                    name: 'clip.mov',
                    totalParts: MULTIPART_PARTS,
                    completedParts: [{ partNumber: 1 }, { partNumber: 2 }],
                },
            ])
        );
        expect(harness.row('clip.mov').progress).toBe(
            Math.round((2 / MULTIPART_PARTS) * 100)
        );
        harness.backend.releasePuts();
        await wave;
    });

    it(`sends at most ${MAX_CONCURRENT_CHUNKS} parts of one file at a time, lowest first`, async () => {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        await harness.queue.addFiles(
            picked(fakeFile('clip.mov', MULTIPART_SIZE))
        );
        const wave = harness.queue.startUpload();

        await vi.waitFor(() =>
            expect(
                harness.backend.inFlight().map((put) => put.partNumber)
            ).toEqual(firstParts)
        );
        harness.backend.releasePuts();
        await wave;

        const [file] = harness.backend.filesNamed('clip.mov');
        expect(harness.backend.peakInFlightFor(file.fileId)).toBe(
            MAX_CONCURRENT_CHUNKS
        );
        expect(file.status).toBe('confirmed');
    });

    it('keeps PUTs across concurrent files inside the S3 connection budget', async () => {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        // Three files at MAX_CONCURRENT_CHUNKS parts each want more sockets
        // than the budget has.
        await harness.queue.addFiles(
            picked(
                fakeFile('a.mov', MULTIPART_SIZE),
                fakeFile('b.mov', MULTIPART_SIZE),
                fakeFile('c.mov', MULTIPART_SIZE)
            )
        );
        const wave = harness.queue.startUpload();

        await vi.waitFor(() =>
            expect(harness.backend.inFlight()).toHaveLength(
                S3_CONNECTION_BUDGET
            )
        );
        harness.backend.releasePuts();
        await wave;

        expect(harness.backend.peakInFlight()).toBe(S3_CONNECTION_BUDGET);
        expect(harness.backend.files.map((file) => file.status)).toEqual([
            'confirmed',
            'confirmed',
            'confirmed',
        ]);
    });

    it('re-presigns an expired part URL and finishes without restarting', async () => {
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.partNumber === 2,
            new UploadHttpError(403)
        );

        await harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));

        const [first, second] = harness.backend.putsFor(2);
        expect(second.url).not.toBe(first.url);
        expect(harness.backend.filesNamed('clip.mov')).toMatchObject([
            { status: 'confirmed' },
        ]);
    });

    it('fails the row and stops its other parts when a part is still refused after re-presigning', async () => {
        const harness = createQueueHarness();
        harness.backend.holdPuts();
        harness.backend.expireUrls((url) => url.includes('/1?'));

        await harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));

        expect(harness.row('clip.mov')).toMatchObject({
            status: 'error',
            error: 'Upload failed — try again',
        });
        // Its siblings in flight were aborted, and no later part started.
        expect(harness.backend.inFlight()).toEqual([]);
        expect(harness.backend.putsFor(MAX_CONCURRENT_CHUNKS + 1)).toEqual([]);
        expect(harness.backend.putsFor(1)).toHaveLength(2);
    });

    it(`retries a failing part up to ${MAX_CHUNK_RETRIES} times with backoff`, async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.partNumber === 2,
            new UploadHttpError(500),
            MAX_CHUNK_RETRIES
        );

        const wave = harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));
        await vi.waitFor(
            async () => {
                await vi.advanceTimersByTimeAsync(1000);
                expect(harness.row('clip.mov').status).toBe('complete');
            },
            { interval: 1 }
        );
        await wave;

        expect(harness.backend.putsFor(2)).toHaveLength(MAX_CHUNK_RETRIES + 1);
    });

    it('waits a second before retrying a failed part', async () => {
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
        // Faked only now: with fake timers on, `vi.waitFor` moves the clock
        // itself on every check.
        vi.useFakeTimers({ toFake: ['setTimeout'] });

        harness.backend.failPut(
            (put) => put.partNumber === 2,
            new UploadHttpError(500)
        );
        await vi.advanceTimersByTimeAsync(999);
        expect(harness.backend.putsFor(2)).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.backend.putsFor(2)).toHaveLength(2);

        harness.backend.releasePuts();
        await wave;
    });

    it('fails the row once the retries run out, leaving it resumable', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const harness = createQueueHarness();
        harness.backend.failNextPuts(
            (put) => put.partNumber === 2,
            new UploadHttpError(500),
            MAX_CHUNK_RETRIES + 1
        );

        const wave = harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));
        await vi.waitFor(
            async () => {
                await vi.advanceTimersByTimeAsync(1000);
                expect(harness.row('clip.mov').status).toBe('error');
            },
            { interval: 1 }
        );
        await wave;

        expect(harness.backend.putsFor(2)).toHaveLength(MAX_CHUNK_RETRIES + 1);
        // The S3 session and the resume record both survive the failure.
        expect(harness.backend.filesNamed('clip.mov')).toMatchObject([
            { status: 'uploading' },
        ]);
        expect(await listUploads()).toHaveLength(1);
    });

    it('Retry after every part landed goes straight to completing the upload', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('multipartComplete', new Error('db down'));
        await harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));
        expect(harness.row('clip.mov').status).toBe('error');

        await harness.queue.retryFile(harness.row('clip.mov').id);

        expect(harness.row('clip.mov').status).toBe('complete');
        expect(harness.backend.puts).toHaveLength(MULTIPART_PARTS);
    });

    it('Retry resumes the same session and sends only the parts S3 is missing', async () => {
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
        // Parts 1 and 3 land; part 2 is refused on its URL and again on the
        // re-presigned one, which fails the row.
        harness.backend.completePuts(
            (put) => put.partNumber === 1 || put.partNumber === 3
        );
        harness.backend.failNextPuts(
            (put) => put.partNumber === 2,
            new UploadHttpError(403)
        );
        harness.backend.failPut(
            (put) => put.partNumber === 2,
            new UploadHttpError(403)
        );
        await wave;
        expect(harness.row('clip.mov').status).toBe('error');
        harness.backend.releasePuts();

        await harness.queue.retryFile(harness.row('clip.mov').id);

        const [session] = harness.backend.files;
        expect(harness.backend.files).toHaveLength(1);
        expect(session.status).toBe('confirmed');
        expect(harness.backend.putsFor(1)).toHaveLength(1);
        expect(harness.backend.putsFor(3)).toHaveLength(1);
        expect(harness.backend.putsFor(2)).toHaveLength(3);
    });

    it('Retry shows the progress S3 already holds before sending another part', async () => {
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
            expect(harness.backend.inFlight()).toHaveLength(
                MAX_CONCURRENT_CHUNKS
            )
        );
        // S3 has all of part 3 when part 4, refused on both URLs, fails the
        // row and aborts it: the tab never hears that part 3 landed.
        harness.backend.landWithoutResponse((put) => put.partNumber === 3);
        harness.backend.failNextPuts(
            (put) => put.partNumber === 4,
            new UploadHttpError(403)
        );
        harness.backend.failPut(
            (put) => put.partNumber === 4,
            new UploadHttpError(403)
        );
        await wave;
        expect(harness.row('clip.mov')).toMatchObject({
            status: 'error',
            progress: Math.round((2 / MULTIPART_PARTS) * 100),
        });

        const retry = harness.queue.retryFile(harness.row('clip.mov').id);

        // Only parts 4 and 5 are sent, and the row already counts part 3.
        await vi.waitFor(() =>
            expect(
                harness.backend.inFlight().map((put) => put.partNumber)
            ).toEqual([4, 5])
        );
        expect(harness.row('clip.mov').progress).toBe(
            Math.round((3 / MULTIPART_PARTS) * 100)
        );
        harness.backend.releasePuts();
        await retry;
        expect(harness.backend.putsFor(3)).toHaveLength(1);
        expect(harness.backend.filesNamed('clip.mov')).toMatchObject([
            { status: 'confirmed' },
        ]);
    });
});

describe('upload funnel events', () => {
    it('a single-part failure and its retry join on the row, each attempt naming its own server file', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('confirmUpload', new Error('db down'));
        await harness.upload(fakeFile('a.jpg', 10));
        await harness.queue.retryFile(harness.row('a.jpg').id);

        const [first, second] = harness.backend.filesNamed('a.jpg');
        const shared = {
            engine: 'single',
            sizeBytes: 10,
            batchId: first.batchId,
            clientUploadId: harness.row('a.jpg').id,
        };
        expect(first.batchId).toEqual(expect.any(String));
        expect(events).toEqual([
            {
                event: PostHogEvent.UploadStarted,
                props: {
                    ...shared,
                    fileId: undefined,
                    isRetry: false,
                    hasResumableState: false,
                },
            },
            {
                event: PostHogEvent.UploadFailed,
                props: {
                    ...shared,
                    fileId: first.fileId,
                    isServerRejection: false,
                },
            },
            {
                event: PostHogEvent.UploadStarted,
                props: {
                    ...shared,
                    fileId: first.fileId,
                    isRetry: true,
                    hasResumableState: false,
                },
            },
            {
                event: PostHogEvent.UploadCompleted,
                props: { ...shared, fileId: second.fileId },
            },
        ]);
    });

    it('a multipart retry reports that it resumes rather than restarts', async () => {
        const harness = createQueueHarness();
        harness.backend.failNext('multipartComplete', new Error('db down'));
        await harness.upload(fakeFile('clip.mov', MULTIPART_SIZE));
        await harness.queue.retryFile(harness.row('clip.mov').id);

        const [session] = harness.backend.filesNamed('clip.mov');
        const shared = {
            engine: 'multipart',
            fileId: session.fileId,
            sizeBytes: MULTIPART_SIZE,
            batchId: session.batchId,
            clientUploadId: harness.row('clip.mov').id,
        };
        expect(events.slice(1)).toEqual([
            {
                event: PostHogEvent.UploadFailed,
                props: { ...shared, isServerRejection: false },
            },
            {
                event: PostHogEvent.UploadStarted,
                props: { ...shared, isRetry: true, hasResumableState: true },
            },
            { event: PostHogEvent.UploadCompleted, props: shared },
        ]);
    });
});
