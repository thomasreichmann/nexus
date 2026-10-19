import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ZipFile } from 'yazl';
import { getS3 } from './aws';
import { resolveEntryNames } from './entryNames';
import type { RetrievalRequestFile } from '@nexus/db/repo/retrievalRequests';

/**
 * A `GetObject` that hasn't happened yet.
 *
 * The entire reason the zip build fits in a Lambda. yazl is handed every entry
 * up front but pumps them one at a time, and a stream is inert until something
 * reads it — so wrapping each object in a generator that only calls S3 on first
 * read means a 1,500-file chunk holds one open connection at a time, not 1,500.
 * Passing `response.Body` directly would open all of them at `addReadStream`
 * time and exhaust the socket pool before the first byte was written.
 *
 * "One at a time" rather than "none until read": yazl starts pumping the first
 * entry as soon as `end()` is called, and backpressure holds the rest until a
 * consumer drains the output. One in-flight object is the invariant that
 * matters, and it holds from the first byte.
 */
function lazyObjectStream(bucket: string, key: string): Readable {
    return Readable.from(
        (async function* () {
            const response = await getS3().send(
                new GetObjectCommand({ Bucket: bucket, Key: key })
            );
            yield* response.Body as Readable;
        })(),
        { objectMode: false }
    );
}

/**
 * A zip of the given files, as a stream, read straight from the files bucket.
 *
 * STORE, never deflate: the archives are photographs and video, which are
 * already compressed, so deflate would burn the Lambda's CPU to save roughly
 * nothing and would make the job compute-bound instead of pure I/O (#406).
 *
 * Nothing here forces zip64. yazl reaches for it only when an entry or offset
 * crosses the 32-bit ceiling, which the chunk cap keeps below — see
 * MAX_CHUNK_BYTES for why that ceiling is worth respecting.
 *
 * Each file goes in under the entry name the partition resolved for the whole
 * request (resolveEntryNames), not one chosen here: this chunk can't see its
 * siblings, so a name picked from inside it could repeat one of theirs.
 */
export function createZipStream(
    bucket: string,
    files: RetrievalRequestFile[]
): Readable {
    const zipfile = new ZipFile();
    const output = zipfile.outputStream as Readable;
    const entryNames = resolveEntryNames(files);

    // yazl reports failures by emitting `error` on the ZipFile, and a piped
    // source stream reports its own on itself — neither reaches `outputStream`,
    // and neither ends it. Unrouted, an S3 read failure or a size mismatch is
    // an uncaught exception that kills the invocation before the handler can
    // record it, while the consumer waits on a stream that will never finish.
    // Destroying the output turns both into a rejection the caller can catch.
    const fail = (error: unknown) => {
        if (output.destroyed) return;
        output.destroy(
            error instanceof Error ? error : new Error(String(error))
        );
    };
    zipfile.on('error', fail);

    files.forEach((file, index) => {
        const source = lazyObjectStream(bucket, file.s3Key);
        source.on('error', fail);
        zipfile.addReadStream(source, entryNames[index]!, {
            compress: false,
            // Declaring the size makes yazl fail loudly if S3 hands back a
            // different number of bytes than the row claims. That mismatch
            // is worth failing a build over: the same number is what the
            // user's quota was billed on and what the partition packed
            // against, so a silent disagreement means one of them is wrong.
            size: file.size,
            mtime: file.createdAt,
            mode: 0o100644,
        });
    });

    zipfile.end();
    return output;
}
