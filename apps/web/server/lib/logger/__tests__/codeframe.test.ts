import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCodeFrame, formatCodeFrame } from '../patches/codeframe';
import { createColorFunctions } from '../patches/highlight';

describe('buildCodeFrame', () => {
    let tempDir: string;
    let testFile: string;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeframe-test-'));
        testFile = path.join(tempDir, 'test.ts');

        // Create a test file with known content
        const content = `import { something } from 'module';

function testFunction() {
    const x = 42;
    throw new Error('test');
}

export { testFunction };
`;
        fs.writeFileSync(testFile, content);
    });

    afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns null for non-existent file', () => {
        const result = buildCodeFrame('/nonexistent/file.ts', 1, 1, 2);
        expect(result).toBeNull();
    });

    it('returns null for line out of bounds', () => {
        const result = buildCodeFrame(testFile, 100, 1, 2);
        expect(result).toBeNull();
    });

    it('returns null for line 0 or negative', () => {
        expect(buildCodeFrame(testFile, 0, 1, 2)).toBeNull();
        expect(buildCodeFrame(testFile, -1, 1, 2)).toBeNull();
    });

    it('extracts correct context lines', () => {
        // Line 5 is "    throw new Error('test');"
        const result = buildCodeFrame(testFile, 5, 5, 2);

        expect(result).not.toBeNull();
        expect(result!.lines).toHaveLength(5); // 2 before + target + 2 after
        expect(result!.targetLine).toBe(5);
        expect(result!.targetColumn).toBe(5);

        // Check line numbers
        expect(result!.lines[0].lineNumber).toBe(3);
        expect(result!.lines[2].lineNumber).toBe(5);
        expect(result!.lines[4].lineNumber).toBe(7);

        // Check target line marking
        expect(result!.lines[2].isTarget).toBe(true);
        expect(result!.lines[0].isTarget).toBe(false);
    });

    it('handles context at start of file', () => {
        const result = buildCodeFrame(testFile, 1, 1, 2);

        expect(result).not.toBeNull();
        // Should have line 1, 2, 3 (no lines before 1)
        expect(result!.lines[0].lineNumber).toBe(1);
    });

    it('handles context at end of file', () => {
        // The test file has 8 lines of content (trailing newline creates 9th empty)
        const result = buildCodeFrame(testFile, 8, 1, 2);

        expect(result).not.toBeNull();
        // Context should include lines 6-9
        expect(result!.lines.length).toBeGreaterThanOrEqual(3);
        expect(
            result!.lines[result!.lines.length - 1].lineNumber
        ).toBeLessThanOrEqual(9);
    });
});

describe('formatCodeFrame', () => {
    it('formats with colors disabled', () => {
        const colors = createColorFunctions(false);
        const frame = {
            lines: [
                { lineNumber: 1, content: 'const x = 1;', isTarget: false },
                {
                    lineNumber: 2,
                    content: 'throw new Error();',
                    isTarget: true,
                },
                { lineNumber: 3, content: 'const y = 2;', isTarget: false },
            ],
            targetLine: 2,
            targetColumn: 7,
        };

        const output = formatCodeFrame(frame, colors);

        // Output: line1, line2 (target with >), caret line, line3
        expect(output).toHaveLength(4); // 3 lines + caret line
        expect(output[0]).toContain('1'); // line number 1
        expect(output[1]).toContain('>'); // target line marker
        expect(output[1]).toContain('2'); // line number 2
        expect(output[2]).toContain('^'); // caret line
        expect(output[3]).toContain('3'); // line number 3
    });

    it('includes line marker for target line', () => {
        const colors = createColorFunctions(false);
        const frame = {
            lines: [{ lineNumber: 5, content: 'test line', isTarget: true }],
            targetLine: 5,
            targetColumn: 3,
        };

        const output = formatCodeFrame(frame, colors);

        // First line should have marker
        expect(output[0]).toMatch(/^>/);
        // Should have caret line
        expect(output[1]).toContain('^');
    });
});
