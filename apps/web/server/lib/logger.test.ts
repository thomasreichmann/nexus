import { describe, expect, it } from 'vitest';
import { formatStackFrame, parseStackFrame } from './logger';

describe('parseStackFrame', () => {
    it('parses stack frame with function name', () => {
        const line = '    at myFunction (/path/to/file.js:10:5)';
        const result = parseStackFrame(line);

        expect(result).toEqual({
            functionName: 'myFunction',
            filePath: '/path/to/file.js',
            line: 10,
            column: 5,
        });
    });

    it('parses stack frame without function name', () => {
        const line = '    at /path/to/file.js:10:5';
        const result = parseStackFrame(line);

        expect(result).toEqual({
            functionName: undefined,
            filePath: '/path/to/file.js',
            line: 10,
            column: 5,
        });
    });

    it('parses stack frame with method call', () => {
        const line = '    at Object.method (/path/to/file.js:42:15)';
        const result = parseStackFrame(line);

        expect(result).toEqual({
            functionName: 'Object.method',
            filePath: '/path/to/file.js',
            line: 42,
            column: 15,
        });
    });

    it('parses stack frame with anonymous function', () => {
        const line = '    at <anonymous> (/path/to/file.js:1:1)';
        const result = parseStackFrame(line);

        expect(result).toEqual({
            functionName: '<anonymous>',
            filePath: '/path/to/file.js',
            line: 1,
            column: 1,
        });
    });

    it('parses Turbopack-style paths', () => {
        const line =
            '    at resolveMiddleware (/Users/thomas/projects/nexus/apps/web/.next/dev/server/chunks/0866b_@trpc_server_dist_09eb4b4a._.js:3810:36)';
        const result = parseStackFrame(line);

        expect(result).toEqual({
            functionName: 'resolveMiddleware',
            filePath:
                '/Users/thomas/projects/nexus/apps/web/.next/dev/server/chunks/0866b_@trpc_server_dist_09eb4b4a._.js',
            line: 3810,
            column: 36,
        });
    });

    it('returns null for non-stack-frame lines', () => {
        expect(parseStackFrame('Error: Something went wrong')).toBeNull();
        expect(parseStackFrame('Some random text')).toBeNull();
        expect(parseStackFrame('')).toBeNull();
    });

    it('returns null for malformed stack frames', () => {
        expect(parseStackFrame('    at file.js')).toBeNull();
        expect(parseStackFrame('    at file.js:10')).toBeNull();
    });
});

describe('formatStackFrame', () => {
    it('formats frame with function name', () => {
        const frame = {
            functionName: 'myFunction',
            filePath: '/path/to/file.ts',
            line: 42,
            column: 8,
        };

        expect(formatStackFrame(frame)).toBe(
            '    at myFunction (/path/to/file.ts:42:8)'
        );
    });

    it('formats frame without function name', () => {
        const frame = {
            filePath: '/path/to/file.ts',
            line: 42,
            column: 8,
        };

        expect(formatStackFrame(frame)).toBe('    at /path/to/file.ts:42:8');
    });
});
