import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, formatDate, formatRelativeTimeCompact } from './format';

describe('formatBytes', () => {
    it('returns "0 Bytes" for zero', () => {
        expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('formats bytes', () => {
        expect(formatBytes(500)).toBe('500 Bytes');
    });

    it('formats kilobytes', () => {
        expect(formatBytes(1024)).toBe('1 KB');
    });

    it('formats megabytes', () => {
        expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('formats gigabytes with decimals', () => {
        expect(formatBytes(4509715660)).toBe('4.2 GB');
    });

    it('formats terabytes', () => {
        expect(formatBytes(1099511627776)).toBe('1 TB');
    });
});

describe('formatDate', () => {
    it('formats a Date object', () => {
        expect(formatDate(new Date('2026-01-02T12:00:00Z'))).toBe(
            'Jan 2, 2026'
        );
    });

    it('formats an ISO string', () => {
        expect(formatDate('2025-12-30T12:00:00.000Z')).toBe('Dec 30, 2025');
    });
});

describe('formatRelativeTimeCompact', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-13T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns "just now" under a minute', () => {
        expect(formatRelativeTimeCompact('2026-07-13T11:59:30Z')).toBe(
            'just now'
        );
    });

    it('formats minutes', () => {
        expect(formatRelativeTimeCompact('2026-07-13T11:35:00Z')).toBe(
            '25m ago'
        );
    });

    it('formats hours', () => {
        expect(formatRelativeTimeCompact('2026-07-13T09:00:00Z')).toBe(
            '3h ago'
        );
    });

    it('formats days', () => {
        expect(formatRelativeTimeCompact('2026-07-12T11:00:00Z')).toBe(
            '1d ago'
        );
    });

    it('formats months', () => {
        expect(formatRelativeTimeCompact('2026-05-01T12:00:00Z')).toBe(
            '2mo ago'
        );
    });

    it('formats years', () => {
        expect(formatRelativeTimeCompact('2024-07-01T12:00:00Z')).toBe(
            '2y ago'
        );
    });

    it('accepts a Date object', () => {
        expect(
            formatRelativeTimeCompact(new Date('2026-07-13T10:00:00Z'))
        ).toBe('2h ago');
    });
});
