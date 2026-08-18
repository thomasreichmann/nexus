import { describe, expect, it } from 'vitest';
import {
    isFileMatch,
    computeRemainingPartNumbers,
    mergeParts,
    partByteRange,
    partsProgress,
    waveProgress,
    isResumable,
} from './parts';
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
