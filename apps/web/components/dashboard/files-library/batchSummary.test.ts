import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    batchIdOf,
    batchKeyOf,
    folderLabel,
    formatTimeLeft,
    restoringPercent,
    toBatchView,
    UNGROUPED_KEY,
} from './batchSummary';
import type { LibraryBatchSummary } from '@nexus/db/repo/library';

const summary = (
    overrides: Partial<LibraryBatchSummary> = {}
): LibraryBatchSummary => ({
    batchId: 'batch-1',
    name: 'Silva Wedding',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    fileCount: 10,
    totalBytes: 1000,
    restoringCount: 0,
    readyCount: 0,
    readyUntil: null,
    archivedProbablyColdCount: 0,
    matchCount: null,
    coverFiles: [],
    ...overrides,
});

describe('toBatchView', () => {
    // A batch reads as its most active state: in flight beats downloadable.
    it.each([
        [{ restoringCount: 2, readyCount: 3 }, 'restoring'],
        [{ restoringCount: 0, readyCount: 3 }, 'ready'],
        [{ restoringCount: 0, readyCount: 0 }, 'archived'],
    ] as const)('reads %o as %s', (counts, status) => {
        expect(toBatchView(summary(counts)).status).toBe(status);
    });

    it('counts what a restore of the batch would ask for: neither in flight nor ready', () => {
        expect(
            toBatchView(summary({ restoringCount: 2, readyCount: 3 }))
                .archivedCount
        ).toBe(5);
    });

    it('names and keys the legacy files with no batch', () => {
        const view = toBatchView(summary({ batchId: null, name: null }));

        expect(view).toMatchObject({ key: UNGROUPED_KEY, name: 'Ungrouped' });
        expect(batchIdOf(view.key)).toBeNull();
        expect(batchKeyOf(null)).toBe(UNGROUPED_KEY);
        expect(batchIdOf(batchKeyOf('batch-1'))).toBe('batch-1');
    });
});

describe('formatTimeLeft', () => {
    const NOW = new Date('2026-10-12T12:00:00Z');
    const inHours = (hours: number) =>
        new Date(NOW.getTime() + hours * 3_600_000);
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts hours inside a day, never under one, and whole days after', () => {
        expect(formatTimeLeft(inHours(0.2))).toBe('1h left');
        expect(formatTimeLeft(inHours(5.4))).toBe('5h left');
        expect(formatTimeLeft(inHours(23.9))).toBe('24h left');
        expect(formatTimeLeft(inHours(24))).toBe('1 day left');
        expect(formatTimeLeft(inHours(24 * 6 + 23))).toBe('6 days left');
    });

    it('says expiring once the window is up, and nothing with no window', () => {
        expect(formatTimeLeft(NOW)).toBe('expiring');
        expect(formatTimeLeft(inHours(-1))).toBe('expiring');
        expect(formatTimeLeft(null)).toBeNull();
    });
});

describe('folderLabel', () => {
    it('names a folder by its path, and the files above every folder', () => {
        expect(folderLabel('104CANON/RAW')).toBe('104CANON/RAW');
        expect(folderLabel(null)).toBe('Top level');
    });
});

describe('restoringPercent', () => {
    // A restore just asked for still shows a sliver of progress.
    it('is the share of the batch restoring, never under a sliver', () => {
        const view = (restoringCount: number) =>
            toBatchView(summary({ fileCount: 200, restoringCount }));

        expect(restoringPercent(view(50))).toBe(25);
        expect(restoringPercent(view(1))).toBe(3);
    });
});
