import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSemaphore } from '@nexus/async';
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
    });
    return {
        session,
        backend,
        notices,
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

    it('starts from the same empty snapshot the server renders', () => {
        const { session } = createSession();

        expect(session.getSnapshot()).toBe(EMPTY_UPLOAD_SNAPSHOT);
    });
});
