import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockGetSignedUrl: vi.fn(),
}));

vi.mock('./client', () => ({
    client: { send: mockSend },
    bucket: 'test-bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: mockGetSignedUrl,
}));

import { create, signParts, complete, abort } from './multipart';

describe('multipart storage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('create', () => {
        it('returns the upload ID from S3', async () => {
            mockSend.mockResolvedValue({ UploadId: 'test-upload-id' });

            const result = await create(
                'user/file/name.zip',
                'application/zip'
            );

            expect(result.uploadId).toBe('test-upload-id');
            expect(mockSend).toHaveBeenCalledOnce();
        });

        it('throws if S3 does not return an UploadId', async () => {
            mockSend.mockResolvedValue({});

            await expect(create('key')).rejects.toThrow(
                'S3 did not return an UploadId'
            );
        });
    });

    describe('signParts', () => {
        it('generates presigned URLs for each part', async () => {
            mockGetSignedUrl.mockResolvedValue('https://signed-url.test');

            const urls = await signParts({
                key: 'user/file/name.zip',
                uploadId: 'test-upload-id',
                partCount: 3,
            });

            expect(urls).toHaveLength(3);
            expect(mockGetSignedUrl).toHaveBeenCalledTimes(3);
        });

        it('uses custom expiry when provided', async () => {
            mockGetSignedUrl.mockResolvedValue('https://signed-url.test');

            await signParts({
                key: 'key',
                uploadId: 'uid',
                partCount: 1,
                expiresIn: 7200,
            });

            expect(mockGetSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                { expiresIn: 7200 }
            );
        });
    });

    describe('complete', () => {
        it('sends CompleteMultipartUploadCommand with parts', async () => {
            mockSend.mockResolvedValue({});

            await complete('key', 'uid', [
                { partNumber: 1, etag: '"abc"' },
                { partNumber: 2, etag: '"def"' },
            ]);

            expect(mockSend).toHaveBeenCalledOnce();
        });
    });

    describe('abort', () => {
        it('sends AbortMultipartUploadCommand', async () => {
            mockSend.mockResolvedValue({});

            await abort('key', 'uid');

            expect(mockSend).toHaveBeenCalledOnce();
        });
    });
});
