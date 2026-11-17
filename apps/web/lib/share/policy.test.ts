import { describe, expect, it } from 'vitest';
import {
    MAX_SHARE_BYTES,
    MAX_SHARE_BYTES_GLOBAL,
    MAX_SHARE_BYTES_PER_IP,
    MAX_SHARE_FILES,
    MAX_SHARES_PER_IP,
} from './limits';
import {
    budgetProblemMessage,
    checkSelection,
    checkShareBudget,
    downloadUrlTtlSeconds,
    selectionProblemMessage,
    totalSize,
} from './policy';

const filesOfSize = (count: number, size: number) =>
    Array.from({ length: count }, () => ({ size }));

describe('checkSelection', () => {
    it('refuses an empty selection', () => {
        expect(checkSelection([])).toBe('empty');
    });

    it('accepts a zero-byte file', () => {
        expect(checkSelection([{ size: 0 }])).toBeNull();
    });

    it('accepts exactly the file limit and refuses one more', () => {
        expect(checkSelection(filesOfSize(MAX_SHARE_FILES, 1))).toBeNull();
        expect(checkSelection(filesOfSize(MAX_SHARE_FILES + 1, 1))).toBe(
            'too-many-files'
        );
    });

    it('accepts exactly the byte limit and refuses one byte more', () => {
        expect(checkSelection([{ size: MAX_SHARE_BYTES }])).toBeNull();
        expect(checkSelection([{ size: MAX_SHARE_BYTES + 1 }])).toBe(
            'too-large'
        );
    });

    it('measures the byte limit across the files, not per file', () => {
        expect(checkSelection([{ size: MAX_SHARE_BYTES }, { size: 1 }])).toBe(
            'too-large'
        );
    });
});

describe('problem messages', () => {
    it('tell the uploader the limit their selection went over', () => {
        expect(selectionProblemMessage('empty')).toBe('Add at least one file');
        expect(selectionProblemMessage('too-many-files')).toContain(
            `${MAX_SHARE_FILES} files`
        );
        expect(selectionProblemMessage('too-large')).toContain('5 GB');
    });

    it('tell the uploader which creation limit they reached', () => {
        expect(budgetProblemMessage('ip-shares')).toContain(
            `${MAX_SHARES_PER_IP} links a day`
        );
        expect(budgetProblemMessage('ip-bytes')).toContain('10 GB a day');
        expect(budgetProblemMessage('global-bytes')).toContain('at capacity');
    });
});

describe('totalSize', () => {
    it('sums the sizes', () => {
        expect(totalSize([{ size: 3 }, { size: 4 }])).toBe(7);
    });
});

describe('checkShareBudget', () => {
    const none = { ipShares: 0, ipBytes: 0, globalBytes: 0 };

    it('accepts a link when nothing has been used', () => {
        expect(checkShareBudget(none, MAX_SHARE_BYTES)).toBeNull();
    });

    it('lets one uploader reach the link limit, and no further', () => {
        expect(
            checkShareBudget({ ...none, ipShares: MAX_SHARES_PER_IP - 1 }, 1)
        ).toBeNull();
        expect(
            checkShareBudget({ ...none, ipShares: MAX_SHARES_PER_IP }, 1)
        ).toBe('ip-shares');
    });

    it('lets one uploader reach the byte limit exactly, and not one byte past it', () => {
        const usage = { ...none, ipBytes: MAX_SHARE_BYTES_PER_IP - 10 };

        expect(checkShareBudget(usage, 10)).toBeNull();
        expect(checkShareBudget(usage, 11)).toBe('ip-bytes');
    });

    it('lets everyone together reach the global limit exactly, and not one byte past it', () => {
        const usage = { ...none, globalBytes: MAX_SHARE_BYTES_GLOBAL - 10 };

        expect(checkShareBudget(usage, 10)).toBeNull();
        expect(checkShareBudget(usage, 11)).toBe('global-bytes');
    });

    it('blames the uploader before the global budget when both are spent', () => {
        expect(
            checkShareBudget(
                {
                    ipShares: 1,
                    ipBytes: MAX_SHARE_BYTES_PER_IP,
                    globalBytes: MAX_SHARE_BYTES_GLOBAL,
                },
                1
            )
        ).toBe('ip-bytes');
    });
});

describe('downloadUrlTtlSeconds', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const inSeconds = (seconds: number) =>
        new Date(now.getTime() + seconds * 1000);

    it('is an hour while the link has more than that left', () => {
        expect(downloadUrlTtlSeconds(inSeconds(3601), now)).toBe(3600);
    });

    it('is what the link has left once that is under an hour', () => {
        expect(downloadUrlTtlSeconds(inSeconds(3599), now)).toBe(3599);
        expect(downloadUrlTtlSeconds(inSeconds(90), now)).toBe(90);
    });

    it('never asks S3 for a URL that is already expired', () => {
        expect(downloadUrlTtlSeconds(inSeconds(0), now)).toBe(1);
    });
});
