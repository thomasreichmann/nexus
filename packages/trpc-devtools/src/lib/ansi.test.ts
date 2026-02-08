import { describe, expect, it } from 'vitest';
import { ansiToHtml, hasAnsi } from './ansi';

describe('hasAnsi', () => {
    it('returns true for strings with ANSI codes', () => {
        expect(hasAnsi('\x1b[1mbold\x1b[0m')).toBe(true);
        expect(hasAnsi('\x1b[36mcyan\x1b[0m')).toBe(true);
    });

    it('returns false for strings without ANSI codes', () => {
        expect(hasAnsi('plain text')).toBe(false);
        expect(hasAnsi('')).toBe(false);
    });
});

describe('ansiToHtml', () => {
    // Note: ansi_up uses inline styles for formatting (bold, faint, italic, underline)
    // and CSS classes for colors (when use_classes=true)

    it('converts bold ANSI code to styled span', () => {
        const result = ansiToHtml('\x1b[1mbold text\x1b[0m');
        expect(result).toContain('font-weight:bold');
        expect(result).toContain('bold text');
    });

    it('converts cyan ANSI code to span with class', () => {
        const result = ansiToHtml('\x1b[36mcyan text\x1b[0m');
        expect(result).toContain('ansi-cyan-fg');
        expect(result).toContain('cyan text');
    });

    it('converts yellow ANSI code to span with class', () => {
        const result = ansiToHtml('\x1b[33myellow text\x1b[0m');
        expect(result).toContain('ansi-yellow-fg');
        expect(result).toContain('yellow text');
    });

    it('converts dim/faint ANSI code to styled span', () => {
        const result = ansiToHtml('\x1b[2mdim text\x1b[0m');
        expect(result).toContain('opacity');
        expect(result).toContain('dim text');
    });

    it('converts bright black (gray) ANSI code to span with class', () => {
        const result = ansiToHtml('\x1b[90mgray text\x1b[0m');
        expect(result).toContain('ansi-bright-black-fg');
        expect(result).toContain('gray text');
    });

    it('handles multiple ANSI sequences', () => {
        const result = ansiToHtml('\x1b[1mconst\x1b[0m x = \x1b[33m42\x1b[0m;');
        expect(result).toContain('font-weight:bold');
        expect(result).toContain('const');
        expect(result).toContain('ansi-yellow-fg');
        expect(result).toContain('42');
    });

    it('escapes HTML characters', () => {
        const result = ansiToHtml('\x1b[1m<div>\x1b[0m');
        expect(result).toContain('&lt;div&gt;');
    });

    it('handles plain text without ANSI codes', () => {
        const result = ansiToHtml('plain text');
        expect(result).toBe('plain text');
    });

    it('handles code frame style output', () => {
        // Simulates a code frame line with multiple ANSI codes
        const input =
            '\x1b[33m>\x1b[0m \x1b[2m42\x1b[0m\x1b[2m | \x1b[0m\x1b[1mconst\x1b[0m x = \x1b[36m"hello"\x1b[0m;';
        const result = ansiToHtml(input);
        expect(result).toContain('ansi-yellow-fg'); // Yellow >
        expect(result).toContain('opacity'); // Dim line number (faint uses inline style)
        expect(result).toContain('font-weight:bold'); // Bold const
        expect(result).toContain('ansi-cyan-fg'); // Cyan string
    });
});
