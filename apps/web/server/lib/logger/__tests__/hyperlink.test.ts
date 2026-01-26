import { describe, expect, it } from 'vitest';
import { wrapWithHyperlink } from '../patches/hyperlink';

describe('wrapWithHyperlink', () => {
    it('returns plain text (hyperlinks currently disabled)', () => {
        const result = wrapWithHyperlink(
            '/path/to/file.ts',
            42,
            5,
            'file.ts:42:5',
            true
        );

        expect(result).toBe('file.ts:42:5');
        expect(result).not.toContain('\x1b');
    });

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
});
