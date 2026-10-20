import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSemaphore } from '@nexus/async';
import { UploadHttpError } from '@/lib/http/xhr';
import { S3_CONNECTION_BUDGET } from './limits';
import { createUploadSession, EMPTY_UPLOAD_SNAPSHOT } from './session';
import {
    createFakeUploadBackend,
    fakeFile,
    picked,
    resetUploadStore,
    type FakeUploadBackend,
} from './testing';
import {
    addCompletedPart,
    deleteUpload,
    listUploads,
    putUpload,
} from './uploadStore';

beforeEach(resetUploadStore);

function createSession(backend: FakeUploadBackend = createFakeUploadBackend()) {
    const connection = new EventTarget();
    let isOnline = true;
    let clock = 0;
    const notices: string[] = [];
    const session = createUploadSession({
        api: backend.api,
        store: { putUpload, addCompletedPart, deleteUpload, listUploads },
        put: backend.put,
        s3Budget: createSemaphore(S3_CONNECTION_BUDGET),
        onWaveDrained: () => {},
        notify: {
            info: (message) => notices.push(message),
            error: (message) => notices.push(message),
        },
        reacquireFile: async () => null,
        isOnline: () => isOnline,
        isFileSystemAccessSupported: () => false,
        connection,
        now: () => clock,
    });
    return {
        session,
        backend,
        notices,
        /** Moves the session's clock to `at` ms. */
        setClock(at: number) {
            clock = at;
        },
        goOffline() {
            isOnline = false;
            connection.dispatchEvent(new Event('offline'));
        },
        goOnline() {
            isOnline = true;
            connection.dispatchEvent(new Event('online'));
        },
    };
}

const statusOf = (session: ReturnType<typeof createSession>['session']) =>
    session.getSnapshot().rows.map((row) => row.status);

describe('the upload session', () => {
    it('keeps a wave’s rows and state, and tells every subscriber when they change', async () => {
        const { session, backend } = createSession();
        const listener = vi.fn();
        session.subscribe(listener);
        backend.holdPuts();

        await session.queue.addFiles(picked(fakeFile('a.jpg', 10)));
        const wave = session.queue.startUpload();
        await vi.waitFor(() => expect(backend.inFlight()).toHaveLength(1));

        expect(session.getSnapshot()).toMatchObject({ isUploading: true });
        expect(statusOf(session)).toEqual(['uploading']);
        expect(listener).toHaveBeenCalled();

        backend.completePuts();
        await wave;
        expect(session.getSnapshot()).toMatchObject({ isUploading: false });
        expect(statusOf(session)).toEqual(['complete']);
    });

    // `useSyncExternalStore` re-renders whenever the snapshot changes
    // identity, so a write that changes nothing must leave it as it was.
    it('keeps the same snapshot, and tells no one, when a write changes nothing', async () => {
        const { session } = createSession();
        await session.queue.addFiles(picked(fakeFile('a.jpg', 10)));
        const before = session.getSnapshot();
        const listener = vi.fn();
        session.subscribe(listener);

        // No duplicates to release, so no row moves.
        session.queue.uploadAllAnyway();

        expect(session.getSnapshot()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
    });

    it('stops telling a subscriber once it unsubscribes', async () => {
        const { session } = createSession();
        const listener = vi.fn();
        const unsubscribe = session.subscribe(listener);

        unsubscribe();
        await session.queue.addFiles(picked(fakeFile('a.jpg', 10)));

        expect(listener).not.toHaveBeenCalled();
    });

    it('pauses the wave when the connection drops, and resumes it when it’s back', async () => {
        const { session, backend, notices, goOffline, goOnline } =
            createSession();
        backend.holdPuts();
        await session.queue.addFiles(picked(fakeFile('a.jpg', 10)));
        const wave = session.queue.startUpload();
        await vi.waitFor(() => expect(backend.inFlight()).toHaveLength(1));

        goOffline();
        await wave;
        expect(statusOf(session)).toEqual(['paused']);

        backend.releasePuts();
        goOnline();
        await vi.waitFor(() => expect(statusOf(session)).toEqual(['complete']));
        expect(notices).toEqual([
            'Upload paused — waiting for your connection',
            'Back online — resuming upload',
        ]);
    });

    it('surfaces the uploads an earlier tab left unfinished', async () => {
        await putUpload({
            fileId: 'file-1',
            uploadId: 'upload-1',
            name: 'clip.mov',
            size: 100,
            lastModified: 0,
            mimeType: 'video/quicktime',
            chunkSize: 10,
            totalParts: 10,
            completedParts: [{ partNumber: 1, etag: '"e1"' }],
            createdAt: 0,
            updatedAt: 0,
        });

        const { session } = createSession();

        await vi.waitFor(() =>
            expect(session.getSnapshot().rows).toMatchObject([
                { id: 'file-1', name: 'clip.mov', status: 'resumable' },
            ])
        );
    });

    // #407: the rate is measured where the wave lives, so it survives the
    // page, and only while the wave runs.
    // From the bytes as they're sent, not the rows' whole percents: one
    // large file can take minutes to move 1%, too rare to measure by.
    it('measures the running wave’s rate and time left from its bytes', async () => {
        const { session, backend, setClock } = createSession();
        backend.holdPuts();
        await session.queue.addFiles(picked(fakeFile('a.mov', 100_000)));
        const wave = session.queue.startUpload();
        await vi.waitFor(() => expect(backend.inFlight()).toHaveLength(1));

        // 40 bytes a second for ten seconds: 0.4%, so the row reads 0%.
        for (let second = 1; second <= 10; second++) {
            setClock(second * 1000);
            backend.reportProgress(() => true, second * 40);
        }

        expect(statusOf(session)).toEqual(['uploading']);
        expect(session.getSnapshot().rows[0]!.progress).toBe(0);
        expect(session.estimate(10_000)).toEqual({
            bytesPerSecond: 40,
            secondsLeft: 2500,
        });
        backend.releasePuts();
        await wave;
        expect(session.estimate(11_000)).toBeNull();
    });

    // A wave whose bytes never drop below the last one's (a retry after a
    // wave that failed at zero) still waits for its own history.
    it('measures each wave afresh', async () => {
        const { session, backend, setClock } = createSession();
        backend.failNextPuts(() => true, new UploadHttpError(500));
        await session.queue.addFiles(picked(fakeFile('a.jpg', 1000)));
        await session.queue.startUpload();
        expect(statusOf(session)).toEqual(['error']);

        setClock(20_000);
        backend.holdPuts();
        const retry = session.queue.retryFile(
            session.getSnapshot().rows[0]!.id
        );
        await vi.waitFor(() => expect(backend.inFlight()).toHaveLength(1));
        setClock(22_000);
        backend.reportProgress(() => true, 100);

        expect(session.estimate(22_000)).toBeNull();
        backend.releasePuts();
        await retry;
    });

    it('starts from the same empty snapshot the server renders', () => {
        const { session } = createSession();

        expect(session.getSnapshot()).toBe(EMPTY_UPLOAD_SNAPSHOT);
    });
});
