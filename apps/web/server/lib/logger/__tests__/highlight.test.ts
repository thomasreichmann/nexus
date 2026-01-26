import { describe, expect, it } from 'vitest';
import { createColorFunctions, highlightLine } from '../patches/highlight';

describe('createColorFunctions', () => {
    it('returns identity functions when disabled', () => {
        const colors = createColorFunctions(false);

        expect(colors.dim('test')).toBe('test');
        expect(colors.gray('test')).toBe('test');
        expect(colors.cyan('test')).toBe('test');
        expect(colors.yellow('test')).toBe('test');
        expect(colors.bold('test')).toBe('test');
    });

    it('returns ANSI escape functions when enabled', () => {
        const colors = createColorFunctions(true);

        expect(colors.dim('test')).toContain('\x1b[2m');
        expect(colors.gray('test')).toContain('\x1b[90m');
        expect(colors.cyan('test')).toContain('\x1b[36m');
        expect(colors.yellow('test')).toContain('\x1b[33m');
        expect(colors.bold('test')).toContain('\x1b[1m');
    });
});

describe('highlightLine', () => {
    const colors = createColorFunctions(false);

    it('highlights keywords', () => {
        const result = highlightLine('const x = 1;', colors);
        expect(result).toContain('const');
    });

    it('handles line with no special tokens', () => {
        const result = highlightLine('someVariable', colors);
        expect(result).toBe('someVariable');
    });

    it('handles empty line', () => {
        const result = highlightLine('', colors);
        expect(result).toBe('');
    });

    it('handles multiple keywords', () => {
        const result = highlightLine('if (true) { return false; }', colors);
        expect(result).toContain('if');
        expect(result).toContain('true');
        expect(result).toContain('return');
        expect(result).toContain('false');
    });

    it('handles string literals', () => {
        const result = highlightLine('const s = "hello world";', colors);
        expect(result).toContain('"hello world"');
    });

    it('handles numbers', () => {
        const result = highlightLine('const n = 42;', colors);
        expect(result).toContain('42');
    });

    it('handles comments', () => {
        const result = highlightLine('// this is a comment', colors);
        expect(result).toContain('// this is a comment');
    });
});

describe('highlightLine with colors', () => {
    const colors = createColorFunctions(true);

    it('applies ANSI codes to keywords', () => {
        const result = highlightLine('const x = 1;', colors);
        // Bold is applied to keywords
        expect(result).toContain('\x1b[1m');
    });

    it('applies ANSI codes to strings', () => {
        const result = highlightLine('const s = "test";', colors);
        // Cyan is applied to strings
        expect(result).toContain('\x1b[36m');
    });

    it('applies ANSI codes to numbers', () => {
        const result = highlightLine('const n = 42;', colors);
        // Yellow is applied to numbers
        expect(result).toContain('\x1b[33m');
    });
});
