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

import {
    create,
    signParts,
    signPartsByNumber,
    listParts,
    complete,
    abort,
} from './multipart';

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

    describe('signPartsByNumber', () => {
        it('presigns only the requested part numbers', async () => {
            mockGetSignedUrl.mockResolvedValue('https://signed-url.test');

            const parts = await signPartsByNumber({
                key: 'user/file/name.zip',
                uploadId: 'test-upload-id',
                partNumbers: [2, 5, 7],
            });

            expect(parts).toEqual([
                { partNumber: 2, url: 'https://signed-url.test' },
                { partNumber: 5, url: 'https://signed-url.test' },
                { partNumber: 7, url: 'https://signed-url.test' },
            ]);
            expect(mockGetSignedUrl).toHaveBeenCalledTimes(3);
        });

        it('uses custom expiry when provided', async () => {
            mockGetSignedUrl.mockResolvedValue('https://signed-url.test');

            await signPartsByNumber({
                key: 'key',
                uploadId: 'uid',
                partNumbers: [1],
                expiresIn: 7200,
            });

            expect(mockGetSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                { expiresIn: 7200 }
            );
        });

        it('returns an empty array for no part numbers', async () => {
            const parts = await signPartsByNumber({
                key: 'key',
                uploadId: 'uid',
                partNumbers: [],
            });

            expect(parts).toEqual([]);
            expect(mockGetSignedUrl).not.toHaveBeenCalled();
        });
    });

    describe('listParts', () => {
        it('returns uploaded parts from a single page', async () => {
            mockSend.mockResolvedValue({
                Parts: [
                    { PartNumber: 1, ETag: '"abc"', Size: 1000 },
                    { PartNumber: 2, ETag: '"def"', Size: 1000 },
                ],
                IsTruncated: false,
            });

            const parts = await listParts('key', 'uid');

            expect(parts).toEqual([
                { partNumber: 1, etag: '"abc"', size: 1000 },
                { partNumber: 2, etag: '"def"', size: 1000 },
            ]);
            expect(mockSend).toHaveBeenCalledOnce();
        });

        it('pages through truncated results', async () => {
            mockSend
                .mockResolvedValueOnce({
                    Parts: [{ PartNumber: 1, ETag: '"a"', Size: 10 }],
                    IsTruncated: true,
                    NextPartNumberMarker: '1',
                })
                .mockResolvedValueOnce({
                    Parts: [{ PartNumber: 2, ETag: '"b"', Size: 10 }],
                    IsTruncated: false,
                });

            const parts = await listParts('key', 'uid');

            expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
            expect(mockSend).toHaveBeenCalledTimes(2);
            // Second call must carry the marker from the first response.
            expect(mockSend.mock.calls[1][0].input).toMatchObject({
                PartNumberMarker: '1',
            });
        });

        it('returns an empty array when no parts have been uploaded', async () => {
            mockSend.mockResolvedValue({ IsTruncated: false });

            const parts = await listParts('key', 'uid');

            expect(parts).toEqual([]);
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
