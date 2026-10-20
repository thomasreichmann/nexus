import { describe, expect, it } from 'vitest';
import {
    isFileMatch,
    toFileIdentityKey,
    indexByFileIdentity,
    computeRemainingPartNumbers,
    mergeParts,
    partByteRange,
    partsProgress,
    summarizeWave,
    waveProgress,
    isResumable,
} from './parts';
import type { UploadStatus } from './rows';
import type { ResumableUpload } from './uploadStore';

describe('isFileMatch', () => {
    const base = { name: 'a.zip', size: 100, lastModified: 5 };

    it('matches identical identity', () => {
        expect(isFileMatch(base, { ...base })).toBe(true);
    });

    it.each([
        ['name', { ...base, name: 'b.zip' }],
        ['size', { ...base, size: 101 }],
        ['lastModified', { ...base, lastModified: 6 }],
    ])('rejects when %s differs', (_field, file) => {
        expect(isFileMatch(base, file)).toBe(false);
    });
});

describe('toFileIdentityKey', () => {
    const base = { name: 'a.zip', size: 100, lastModified: 5 };

    it('distinguishes name, size, and lastModified', () => {
        expect(toFileIdentityKey(base)).toBe(toFileIdentityKey({ ...base }));
        for (const other of [
            { ...base, name: 'b.zip' },
            { ...base, size: 101 },
            { ...base, lastModified: 6 },
        ]) {
            expect(toFileIdentityKey(other)).not.toBe(toFileIdentityKey(base));
        }
    });

    it('does not collide on a name that embeds a separator', () => {
        expect(toFileIdentityKey({ ...base, name: 'a.zip",100,5' })).not.toBe(
            toFileIdentityKey(base)
        );
    });
});

describe('indexByFileIdentity', () => {
    const record = (fileId: string, name: string) =>
        ({ fileId, name, size: 1, lastModified: 1 }) as ResumableUpload;

    it('keys records by identity and keeps the first on a collision', () => {
        const index = indexByFileIdentity([
            record('first', 'a.zip'),
            record('other', 'b.zip'),
            record('second', 'a.zip'),
        ]);
        expect(index.size).toBe(2);
        expect(index.get(toFileIdentityKey(record('x', 'a.zip')))?.fileId).toBe(
            'first'
        );
    });
});

describe('computeRemainingPartNumbers', () => {
    it('returns all parts when none done', () => {
        expect(computeRemainingPartNumbers(3, [])).toEqual([1, 2, 3]);
    });

    it('skips completed parts regardless of order', () => {
        expect(
            computeRemainingPartNumbers(5, [
                { partNumber: 3, etag: '"c"' },
                { partNumber: 1, etag: '"a"' },
            ])
        ).toEqual([2, 4, 5]);
    });

    it('returns empty when all done', () => {
        expect(
            computeRemainingPartNumbers(2, [
                { partNumber: 1, etag: '"a"' },
                { partNumber: 2, etag: '"b"' },
            ])
        ).toEqual([]);
    });
});

describe('mergeParts', () => {
    it('sorts by part number across groups', () => {
        expect(
            mergeParts(
                [{ partNumber: 3, etag: '"c"' }],
                [
                    { partNumber: 1, etag: '"a"' },
                    { partNumber: 2, etag: '"b"' },
                ]
            )
        ).toEqual([
            { partNumber: 1, etag: '"a"' },
            { partNumber: 2, etag: '"b"' },
            { partNumber: 3, etag: '"c"' },
        ]);
    });

    it('lets later groups win on conflict (fresh etag replaces stale)', () => {
        expect(
            mergeParts(
                [{ partNumber: 1, etag: '"stale"' }],
                [{ partNumber: 1, etag: '"fresh"' }]
            )
        ).toEqual([{ partNumber: 1, etag: '"fresh"' }]);
    });
});

describe('partByteRange', () => {
    it('computes a full chunk', () => {
        expect(partByteRange(2, 100, 1000)).toEqual({ start: 100, end: 200 });
    });

    it('clamps the final chunk to file size', () => {
        expect(partByteRange(3, 100, 250)).toEqual({ start: 200, end: 250 });
    });
});

describe('partsProgress', () => {
    it('rounds completed/total to a percentage', () => {
        expect(partsProgress(1, 3)).toBe(33);
        expect(partsProgress(3, 3)).toBe(100);
    });

    it('is 0 for zero total', () => {
        expect(partsProgress(0, 0)).toBe(0);
    });
});

describe('waveProgress', () => {
    it('weights by bytes, not by row count', () => {
        // The big file at 50% dominates nine tiny finished files.
        const rows = [
            { size: 9_000, progress: 50 },
            ...Array.from({ length: 9 }, () => ({ size: 100, progress: 100 })),
        ];
        expect(waveProgress(rows)).toBe(55);
    });

    it('is 100 when every byte is done and 0 for an empty wave', () => {
        expect(waveProgress([{ size: 10, progress: 100 }])).toBe(100);
        expect(waveProgress([])).toBe(0);
        expect(waveProgress([{ size: 0, progress: 100 }])).toBe(0);
    });
});

describe('summarizeWave', () => {
    const row = (status: UploadStatus, size = 100, progress = 0) => ({
        status,
        size,
        progress,
    });

    it('counts and weighs only the rows the user submitted', () => {
        const wave = summarizeWave(
            [
                row('complete', 100, 100),
                row('error', 100, 40),
                row('uploading', 200, 50),
                row('paused', 100, 0),
                // Not submitted: none of these is the wave's work.
                row('pending', 1000),
                row('resumable', 1000),
                row('checking', 1000),
                row('duplicate', 1000),
            ],
            true
        );

        expect(wave).toEqual({
            isActive: true,
            fileCount: 4,
            completedCount: 1,
            errorCount: 1,
            // (100 + 40 + 100 + 0) of 500 bytes.
            percent: 48,
        });
    });

    // `isUploading` blinks off during the batch round trip of an Upload click
    // made mid-wave, while the pool still holds rows.
    it('is active while rows are queued or uploading, whatever isUploading says', () => {
        expect(summarizeWave([row('queued')], false).isActive).toBe(true);
        expect(summarizeWave([row('uploading')], false).isActive).toBe(true);
        expect(summarizeWave([], true).isActive).toBe(true);
    });

    it('is over once nothing is in flight', () => {
        expect(
            summarizeWave(
                [row('complete', 100, 100), row('error'), row('paused')],
                false
            ).isActive
        ).toBe(false);
    });
});

describe('isResumable', () => {
    const record: ResumableUpload = {
        fileId: 'f',
        uploadId: 'u',
        name: 'a.zip',
        size: 1,
        lastModified: 1,
        mimeType: '',
        chunkSize: 1,
        totalParts: 3,
        completedParts: [],
        createdAt: 1,
        updatedAt: 1,
    };

    it('is true when parts remain', () => {
        expect(isResumable({ ...record, completedParts: [] })).toBe(true);
    });

    it('is false when all parts are done', () => {
        expect(
            isResumable({
                ...record,
                completedParts: [
                    { partNumber: 1, etag: '"a"' },
                    { partNumber: 2, etag: '"b"' },
                    { partNumber: 3, etag: '"c"' },
                ],
            })
        ).toBe(false);
    });
});
