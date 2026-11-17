import { createSemaphore } from '@nexus/async';
import { retryAsync } from '@/lib/async/retry';
import { UploadHttpError, type xhrPut } from '@/lib/http/xhr';
import { isAbortError } from '@/lib/upload/errors';

/**
 * Moves one selection of files to a share link: mint the link, PUT every file,
 * turn the link on. Everything that leaves the tab arrives as a dependency, so
 * it runs unchanged in the browser (tRPC mutations, XHR) and in unit tests
 * (in-memory fakes).
 */

/** Three PUTs at a time: enough to keep a link of small files moving, well inside the browser's six connections per host. */
const MAX_CONCURRENT_PUTS = 3;
const MAX_PUT_RETRIES = 2;

export interface ShareLink {
    id: string;
    expiresAt: Date;
}

export interface ShareUploadDeps {
    /** `shares.create`. `uploads` comes back in the order of `files`. */
    create(input: {
        files: { name: string; size: number }[];
    }): Promise<ShareLink & { uploads: { fileId: string; url: string }[] }>;
    /** `shares.complete`. */
    complete(input: { id: string }): Promise<ShareLink>;
    /** The browser→S3 PUT (`xhrPut`). */
    put: typeof xhrPut;
}

/**
 * What an upload has achieved so far. It outlives a failed run, so trying
 * again re-sends only the files that didn't arrive, to the link already
 * minted, instead of spending another link from the uploader's daily limit.
 */
export interface ShareUploadSession {
    link?: ShareLink & { uploads: { fileId: string; url: string }[] };
    /** Indexes into the selection of the files S3 has accepted. */
    uploaded: Set<number>;
}

export function createShareUploadSession(): ShareUploadSession {
    return { uploaded: new Set() };
}

export interface ShareUploadOptions {
    signal?: AbortSignal;
    /** Bytes of file `index` on the wire so far, in its current attempt. */
    onProgress?: (index: number, loaded: number) => void;
}

/**
 * Run the upload to its end, or throw the first failure once every in-flight
 * file has settled. Call it again with the same `session` to retry.
 */
export async function runShareUpload(
    files: readonly File[],
    session: ShareUploadSession,
    deps: ShareUploadDeps,
    options: ShareUploadOptions = {}
): Promise<ShareLink> {
    session.link ??= await deps.create({
        files: files.map((file) => ({ name: file.name, size: file.size })),
    });
    const { id, uploads } = session.link;

    const budget = createSemaphore(MAX_CONCURRENT_PUTS);
    const pending = files
        .map((file, index) => ({ file, index }))
        .filter(({ index }) => !session.uploaded.has(index));

    const results = await Promise.allSettled(
        pending.map(({ file, index }) =>
            budget.run(async () => {
                options.signal?.throwIfAborted();
                await retryAsync(
                    () =>
                        deps.put(uploads[index].url, file, {
                            signal: options.signal,
                            onProgress: (loaded) =>
                                options.onProgress?.(index, loaded),
                        }),
                    MAX_PUT_RETRIES,
                    1000,
                    isWorthRetrying
                );
                session.uploaded.add(index);
            })
        )
    );

    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;

    return deps.complete({ id });
}

/**
 * A dropped connection or a 5xx may pass on a second try. An abort is the
 * user's own cancel, and a 4xx is S3 refusing this URL (expired, or a body of
 * the wrong length), which no repeat of the same request changes.
 */
function isWorthRetrying(error: unknown): boolean {
    if (isAbortError(error)) return false;
    if (error instanceof UploadHttpError) return error.status >= 500;
    return true;
}
