import type { RetrievalRequestFile } from '@nexus/db/repo/retrievalRequests';

/**
 * Largest zip we will build, in bytes.
 *
 * Decimal 4 GB rather than 4 GiB, and that gap is the point: zip's 32-bit size
 * and offset fields top out at 0xFFFFFFFE (4,294,967,294), so staying below
 * 4,000,000,000 leaves ~294 MB of headroom for entry headers and the central
 * directory before the writer would have to reach for zip64. No zip64 is what
 * makes the archives open in every OS's built-in unarchiver (#406) — macOS
 * Archive Utility has historically mishandled streamed zip64.
 *
 * It is a UX number more than an infra one: chunks keep browser downloads at a
 * resumable scale and per-chunk retries cheap.
 */
export const MAX_CHUNK_BYTES = 4_000_000_000;

/**
 * Most files in one zip.
 *
 * The other zip32 ceiling: the end-of-central-directory record counts entries
 * in 16 bits, so 65,535 is the hard limit. 10,000 keeps a comfortable margin
 * and also bounds a chunk of very small files, which the byte cap alone would
 * let grow to hundreds of thousands of entries.
 */
export const MAX_CHUNK_FILES = 10_000;

/**
 * Split a request's files into the chunks that become zip artifacts.
 *
 * Next-fit over the caller's ordering, not a size-sorted bin-pack: the input
 * arrives sorted by S3 key, so walking it in order and closing the current
 * chunk when the next file would overflow keeps files that were uploaded
 * together in the same zip. A first-fit-decreasing pack would waste fewer bytes
 * per chunk and scatter one shoot across every part of the download, which is
 * the opposite of what the user is trying to do with them.
 *
 * A file larger than the cap gets a chunk to itself. That archive does exceed
 * the zip32 ceiling and the writer will fall back to zip64 for it — the
 * alternative is refusing to deliver a file the user already stored, and
 * raising the cap properly is out of scope (#406).
 */
export function partitionIntoChunks(
    files: RetrievalRequestFile[]
): RetrievalRequestFile[][] {
    const chunks: RetrievalRequestFile[][] = [];
    let current: RetrievalRequestFile[] = [];
    let currentBytes = 0;

    for (const file of files) {
        const isOverflowing =
            currentBytes + file.size > MAX_CHUNK_BYTES ||
            current.length >= MAX_CHUNK_FILES;

        if (current.length > 0 && isOverflowing) {
            chunks.push(current);
            current = [];
            currentBytes = 0;
        }

        current.push(file);
        currentBytes += file.size;
    }

    if (current.length > 0) chunks.push(current);

    return chunks;
}
