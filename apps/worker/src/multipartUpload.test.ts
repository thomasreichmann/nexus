import { Readable } from 'node:stream';
import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ send: vi.fn() }));

// The helper is imported inside the factory, not at the top of the file:
// `vi.mock` is hoisted above every import, so a module-scope binding it closed
// over would not be initialised yet.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const { mockS3Module } = await import('./testing');
    return mockS3Module(importOriginal, hoisted.send);
});

import { uploadStreamMultipart } from './multipartUpload';

const MB = 1024 * 1024;

/** Commands of one type that were sent, in order. */
function sent<T>(type: new (...args: never[]) => T): T[] {
    return hoisted.send.mock.calls
        .map(([command]) => command)
        .filter((command): command is T => command instanceof type);
}

describe('uploadStreamMultipart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        let part = 0;
        hoisted.send.mockImplementation((command: unknown) => {
            if (command instanceof UploadPartCommand) {
                part++;
                return Promise.resolve({ ETag: `"etag-${part}"` });
            }
            return Promise.resolve({ UploadId: 'upload-1' });
        });
    });

    it('cuts parts at the part size and completes with every ETag', async () => {
        // 20MB across chunks that do not align to the 8MB part boundary.
        const body = Readable.from(
            Array.from({ length: 20 }, () => Buffer.alloc(MB, 1))
        );

        const result = await uploadStreamMultipart('bucket', 'key.zip', body);

        expect(result.sizeBytes).toBe(20 * MB);

        const parts = sent(UploadPartCommand);
        expect(parts.map((p) => p.input.ContentLength)).toEqual([
            8 * MB,
            8 * MB,
            4 * MB,
        ]);
        expect(parts.map((p) => p.input.PartNumber)).toEqual([1, 2, 3]);

        const [complete] = sent(CompleteMultipartUploadCommand);
        expect(complete.input.MultipartUpload?.Parts).toEqual([
            { PartNumber: 1, ETag: '"etag-1"' },
            { PartNumber: 2, ETag: '"etag-2"' },
            { PartNumber: 3, ETag: '"etag-3"' },
        ]);
    });

    it('sends a body smaller than one part as a single final part', async () => {
        const body = Readable.from([Buffer.alloc(1024, 7)]);

        const result = await uploadStreamMultipart('bucket', 'key.zip', body);

        expect(result.sizeBytes).toBe(1024);
        expect(sent(UploadPartCommand)).toHaveLength(1);
        expect(sent(CompleteMultipartUploadCommand)).toHaveLength(1);
    });

    // An abandoned multipart upload bills for its parts until something reaps
    // it; the bucket rule is the backstop for a container that dies, not for a
    // failure we are still alive to handle.
    it('aborts the upload when the body fails mid-stream', async () => {
        const body = Readable.from(
            (async function* () {
                yield Buffer.alloc(MB, 1);
                throw new Error('S3 read failed');
            })()
        );

        await expect(
            uploadStreamMultipart('bucket', 'key.zip', body)
        ).rejects.toThrow('S3 read failed');

        expect(sent(AbortMultipartUploadCommand)).toHaveLength(1);
        expect(sent(CompleteMultipartUploadCommand)).toHaveLength(0);
    });

    it('aborts rather than completing an empty upload', async () => {
        const body = Readable.from([]);

        await expect(
            uploadStreamMultipart('bucket', 'key.zip', body)
        ).rejects.toThrow(/empty multipart upload/);

        expect(sent(AbortMultipartUploadCommand)).toHaveLength(1);
    });

    it('fails when S3 hands back no UploadId', async () => {
        hoisted.send.mockResolvedValue({});

        await expect(
            uploadStreamMultipart(
                'bucket',
                'key.zip',
                Readable.from([Buffer.alloc(8)])
            )
        ).rejects.toThrow(/no UploadId/);
    });
});
