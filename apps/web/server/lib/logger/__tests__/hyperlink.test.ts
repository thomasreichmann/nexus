import { describe, expect, it } from 'vitest';
import { fileHyperlink, wrapWithHyperlink } from '../patches/hyperlink';

describe('fileHyperlink', () => {
    it('creates OSC 8 hyperlink with file URL', () => {
        const result = fileHyperlink('/path/to/file.ts', 42, 5, 'file.ts:42:5');

        expect(result).toContain('\x1b]8;;');
        expect(result).toContain('file:///path/to/file.ts:42:5');
        expect(result).toContain('file.ts:42:5');
        expect(result).toContain('\x1b]8;;\x1b\\');
    });

    it('formats URL correctly with line and column', () => {
        const result = fileHyperlink('/test.ts', 1, 1, 'test');

        // Should have the URL format: file://path:line:col
        expect(result).toContain('file:///test.ts:1:1');
    });
});

describe('wrapWithHyperlink', () => {
    it('returns plain text when disabled', () => {
        const result = wrapWithHyperlink(
            '/path/to/file.ts',
            42,
            5,
            'file.ts:42:5',
            false
        );

        expect(result).toBe('file.ts:42:5');
        expect(result).not.toContain('\x1b');
    });

    it('returns hyperlink when enabled', () => {
        const result = wrapWithHyperlink(
            '/path/to/file.ts',
            42,
            5,
            'file.ts:42:5',
            true
        );

        expect(result).toContain('\x1b]8;;');
        expect(result).toContain('file:///path/to/file.ts:42:5');
    });
});
