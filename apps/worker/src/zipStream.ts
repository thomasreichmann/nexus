import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ZipFile } from 'yazl';
import { getS3 } from './aws';
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
 * Make one file's name safe and unique as a zip entry name.
 *
 * Uniqueness matters more than it looks: burst siblings from two different
 * shoots are routinely both `_MG_4501.CR2`, and a zip with duplicate entry
 * names silently loses one of them on extraction. The ` (2)` suffix is what
 * every desktop file manager does, so it reads as intended rather than as
 * corruption.
 *
 * Path separators and `..` are stripped rather than escaped: names are supposed
 * to be flat (folder uploads keep only the top folder, as the batch name), so
 * anything path-shaped is either a stored oddity or an attempt to write outside
 * the extraction directory.
 */
function toEntryName(name: string, taken: Set<string>): string {
    const flat =
        name
            .replace(/[/\\]+/g, '_')
            .replace(/^\.+/, '')
            .trim() || 'file';

    if (!taken.has(flat)) {
        taken.add(flat);
        return flat;
    }

    const dot = flat.lastIndexOf('.');
    const stem = dot > 0 ? flat.slice(0, dot) : flat;
    const ext = dot > 0 ? flat.slice(dot) : '';
    for (let n = 2; ; n++) {
        const candidate = `${stem} (${n})${ext}`;
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }
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
 */
export function createZipStream(
    bucket: string,
    files: RetrievalRequestFile[]
): Readable {
    const zipfile = new ZipFile();
    const output = zipfile.outputStream as Readable;
    const taken = new Set<string>();

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

    for (const file of files) {
        const source = lazyObjectStream(bucket, file.s3Key);
        source.on('error', fail);
        zipfile.addReadStream(source, toEntryName(file.name, taken), {
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
    }

    zipfile.end();
    return output;
}
