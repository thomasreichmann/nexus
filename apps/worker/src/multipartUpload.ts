import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getS3 } from './aws';
import type { Readable } from 'node:stream';

/**
 * Bytes buffered per multipart part.
 *
 * Above S3's 5 MB minimum for a non-final part, and large enough that the
 * 10,000-part ceiling is never in play: a 4 GB artifact is ~500 parts. This is
 * also the whole memory cost of an upload — one part in flight at a time — so
 * it is the number that keeps a 4 GB zip inside a 2 GB Lambda.
 */
const PART_SIZE = 8 * 1024 * 1024;

/**
 * Stream a body of unknown length into S3 as a multipart upload.
 *
 * Unknown length is the reason this exists rather than a `PutObject`: the zip
 * is generated as it uploads, so its size isn't known until the last byte, and
 * `PutObject` with a stream body would make the SDK buffer the whole thing to
 * set `Content-Length`. Parts are cut at a fixed size and uploaded one at a
 * time, so memory stays flat no matter how large the archive gets.
 *
 * Concurrency is deliberately one. The parts arrive serially from a single zip
 * writer anyway, so a queue would only buy overlap between the last part's
 * upload and the next part's assembly — at the cost of holding several parts in
 * memory, which is the one thing this must not do.
 *
 * `@aws-sdk/lib-storage`'s `Upload` covers the same ground and was considered.
 * It is not used because the memory ceiling is the whole point here and that
 * library makes it a product of its own `partSize` x `queueSize` read-ahead
 * rather than a constant this file states outright — and because taking it on
 * would add a runtime dependency to a bundle that inlines everything, to
 * replace a loop this size.
 */
export async function uploadStreamMultipart(
    bucket: string,
    key: string,
    body: Readable
): Promise<{ sizeBytes: number }> {
    const created = await getS3().send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key })
    );
    const uploadId = created.UploadId;
    if (!uploadId) {
        throw new Error(
            `S3 returned no UploadId for multipart upload of ${key}`
        );
    }

    const parts: { PartNumber: number; ETag: string }[] = [];
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;
    let sizeBytes = 0;

    async function flush(): Promise<void> {
        if (bufferedBytes === 0) return;
        const partNumber = parts.length + 1;
        const partBody = Buffer.concat(buffered, bufferedBytes);
        buffered = [];
        bufferedBytes = 0;

        const uploaded = await getS3().send(
            new UploadPartCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                PartNumber: partNumber,
                Body: partBody,
                // Explicit: the SDK cannot infer a length it wasn't given, and
                // without it the part would be sent chunked.
                ContentLength: partBody.length,
            })
        );
        if (!uploaded.ETag) {
            throw new Error(`S3 returned no ETag for part ${partNumber}`);
        }
        parts.push({ PartNumber: partNumber, ETag: uploaded.ETag });
    }

    try {
        for await (const chunk of body) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            buffered.push(buf);
            bufferedBytes += buf.length;
            sizeBytes += buf.length;
            if (bufferedBytes >= PART_SIZE) await flush();
        }
        await flush();

        if (parts.length === 0) {
            throw new Error(
                `Refusing to complete an empty multipart upload for ${key}`
            );
        }

        await getS3().send(
            new CompleteMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: { Parts: parts },
            })
        );

        return { sizeBytes };
    } catch (error) {
        // An abandoned multipart upload bills for its parts until something
        // reaps it. The bucket's abort-incomplete-multipart rule is the
        // backstop for a container that dies before reaching this line; when we
        // are still alive to do it, do it now rather than a day later.
        try {
            await getS3().send(
                new AbortMultipartUploadCommand({
                    Bucket: bucket,
                    Key: key,
                    UploadId: uploadId,
                })
            );
        } catch (abortError) {
            console.warn(
                `Failed to abort multipart upload ${uploadId} for ${key}:`,
                abortError
            );
        }
        throw error;
    }
}
