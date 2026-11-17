import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    UploadHttpError,
    UploadNetworkError,
    type xhrPut,
} from '@/lib/http/xhr';
import {
    createShareUploadSession,
    runShareUpload,
    type ShareUploadDeps,
} from './upload';

const EXPIRES_AT = new Date('2026-11-18T12:00:00Z');

/**
 * An in-memory stand-in for the server and S3. It behaves like them rather
 * than recording calls: a link only goes live if S3 holds every one of its
 * files, so an engine that skips a PUT or completes early goes red on its own.
 */
function createFakeBackend() {
    const links = new Map<string, { names: string[]; isLive: boolean }>();
    /** URL -> name of the file stored there. */
    const stored = new Map<string, string>();
    /** Every body S3 accepted, in arrival order. A re-sent file shows twice. */
    const accepted: string[] = [];
    const refusedNames = new Set<string>();
    /** Files S3 answers 500 for, once each. */
    const flakyNames = new Set<string>();
    /** Files whose connection drops before S3 answers, once each. */
    const droppedNames = new Set<string>();
    /** Every PUT the browser started, whatever became of it. */
    const attempts: string[] = [];
    let inFlight = 0;
    let peakInFlight = 0;

    const urlFor = (id: string, index: number) =>
        `https://s3.test/${id}/${index}`;

    const deps: ShareUploadDeps = {
        async create({ files }) {
            const id = `link${links.size + 1}`;
            links.set(id, {
                names: files.map((file) => file.name),
                isLive: false,
            });
            return {
                id,
                expiresAt: EXPIRES_AT,
                uploads: files.map((_, index) => ({
                    fileId: `file${index}`,
                    url: urlFor(id, index),
                })),
            };
        },
        async complete({ id }) {
            const link = links.get(id);
            if (!link) throw new Error(`no such link: ${id}`);
            const missing = link.names.filter(
                (name, index) => stored.get(urlFor(id, index)) !== name
            );
            if (missing.length > 0) {
                throw new Error(`completed without: ${missing.join(', ')}`);
            }
            link.isLive = true;
            return { id, expiresAt: EXPIRES_AT };
        },
        put: (async (url, body, options) => {
            const file = body as File;
            attempts.push(file.name);
            inFlight++;
            peakInFlight = Math.max(peakInFlight, inFlight);
            // A real PUT spans at least one turn of the event loop.
            await new Promise((resolve) => setTimeout(resolve, 0));
            inFlight--;
            options.signal?.throwIfAborted();
            if (droppedNames.delete(file.name)) throw new UploadNetworkError();
            if (flakyNames.delete(file.name)) throw new UploadHttpError(500);
            // 403: how S3 refuses a presigned URL. Not worth a retry.
            if (refusedNames.has(file.name)) throw new UploadHttpError(403);
            options.onProgress?.(file.size, file.size);
            stored.set(url, file.name);
            accepted.push(file.name);
            return { etag: null };
        }) as typeof xhrPut,
    };

    return {
        deps,
        links,
        stored,
        accepted,
        refusedNames,
        flakyNames,
        droppedNames,
        attempts,
        peakInFlight: () => peakInFlight,
    };
}

const file = (name: string, size = 4) => new File([new Uint8Array(size)], name);

afterEach(() => {
    vi.useRealTimers();
});

describe('runShareUpload', () => {
    it('stores every file at its own URL and turns the link on', async () => {
        const backend = createFakeBackend();
        const files = [file('a.txt'), file('b.txt'), file('c.txt')];

        const link = await runShareUpload(
            files,
            createShareUploadSession(),
            backend.deps
        );

        expect(link).toEqual({ id: 'link1', expiresAt: EXPIRES_AT });
        expect(backend.links.get('link1')?.isLive).toBe(true);
        expect([...backend.stored.values()].sort()).toEqual([
            'a.txt',
            'b.txt',
            'c.txt',
        ]);
    });

    it('reports each file’s bytes against its position in the selection', async () => {
        const backend = createFakeBackend();
        const progress: [number, number][] = [];

        await runShareUpload(
            [file('a.txt', 3), file('b.txt', 9)],
            createShareUploadSession(),
            backend.deps,
            { onProgress: (index, loaded) => progress.push([index, loaded]) }
        );

        expect(progress.sort()).toEqual([
            [0, 3],
            [1, 9],
        ]);
    });

    it('never has more than three files on the wire at once', async () => {
        const backend = createFakeBackend();
        const files = Array.from({ length: 8 }, (_, i) => file(`${i}.txt`));

        await runShareUpload(files, createShareUploadSession(), backend.deps);

        expect(backend.peakInFlight()).toBe(3);
    });

    it('leaves the link dark when S3 refuses a file, while the others still arrive', async () => {
        const backend = createFakeBackend();
        backend.refusedNames.add('b.txt');
        const files = [file('a.txt'), file('b.txt'), file('c.txt')];

        await expect(
            runShareUpload(files, createShareUploadSession(), backend.deps)
        ).rejects.toBeInstanceOf(UploadHttpError);

        expect(backend.links.get('link1')?.isLive).toBe(false);
        expect([...backend.stored.values()].sort()).toEqual(['a.txt', 'c.txt']);
    });

    it('does not repeat a PUT that S3 refused outright', async () => {
        const backend = createFakeBackend();
        backend.refusedNames.add('a.txt');

        await runShareUpload(
            [file('a.txt')],
            createShareUploadSession(),
            backend.deps
        ).catch(() => {});

        expect(backend.attempts).toEqual(['a.txt']);
    });

    it('sends a file again when S3 answers with a server error', async () => {
        vi.useFakeTimers();
        const backend = createFakeBackend();
        backend.flakyNames.add('a.txt');

        const run = runShareUpload(
            [file('a.txt')],
            createShareUploadSession(),
            backend.deps
        );
        await vi.runAllTimersAsync();

        expect((await run).id).toBe('link1');
        expect(backend.attempts).toEqual(['a.txt', 'a.txt']);
        expect(backend.links.get('link1')?.isLive).toBe(true);
    });

    it('sends a file again when its connection drops', async () => {
        vi.useFakeTimers();
        const backend = createFakeBackend();
        backend.droppedNames.add('a.txt');

        const run = runShareUpload(
            [file('a.txt')],
            createShareUploadSession(),
            backend.deps
        );
        await vi.runAllTimersAsync();

        expect((await run).id).toBe('link1');
        expect(backend.attempts).toEqual(['a.txt', 'a.txt']);
    });

    it('finishes the same link on a retry, sending only the file that failed', async () => {
        const backend = createFakeBackend();
        backend.refusedNames.add('b.txt');
        const files = [file('a.txt'), file('b.txt')];
        const session = createShareUploadSession();
        await runShareUpload(files, session, backend.deps).catch(() => {});
        backend.refusedNames.clear();

        const link = await runShareUpload(files, session, backend.deps);

        expect(link.id).toBe('link1');
        expect(backend.links.size).toBe(1);
        expect(backend.links.get('link1')?.isLive).toBe(true);
        expect(backend.accepted).toEqual(['a.txt', 'b.txt']);
    });

    it('stops without turning the link on when the upload is cancelled mid-flight', async () => {
        const backend = createFakeBackend();
        const controller = new AbortController();
        const session = createShareUploadSession();
        // Like `xhrPut`: stays open until aborted, then rejects.
        const started: string[] = [];
        const put = ((_url, body, options) =>
            new Promise((_resolve, reject) => {
                started.push((body as File).name);
                options.signal?.addEventListener('abort', () =>
                    reject(new DOMException('Upload aborted', 'AbortError'))
                );
            })) as typeof xhrPut;

        const run = runShareUpload(
            [file('a.txt'), file('b.txt')],
            session,
            { ...backend.deps, put },
            { signal: controller.signal }
        );
        await vi.waitFor(() => expect(started).toHaveLength(2));
        controller.abort();

        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        // Each file was started once: a cancel is not a failure to retry.
        expect(started).toEqual(['a.txt', 'b.txt']);
        expect(session.uploaded.size).toBe(0);
        expect(backend.links.get('link1')?.isLive).toBe(false);
    });
});
