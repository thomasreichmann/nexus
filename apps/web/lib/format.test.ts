import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate } from './format';

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
