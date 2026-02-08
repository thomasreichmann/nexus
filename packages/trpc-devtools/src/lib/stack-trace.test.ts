import { describe, it, expect } from 'vitest';
import { parseStackTrace } from './stack-trace';

describe('parseStackTrace', () => {
    it('parses a simple code frame', () => {
        const input = `  55 | const foo = 'bar';
  56 |     const result = await next();
> 57 |
     | ^
  58 |     return result;`;

        const result = parseStackTrace(input);

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].type).toBe('codeFrame');

        const frame =
            result.segments[0].type === 'codeFrame'
                ? result.segments[0].frame
                : null;
        expect(frame).not.toBeNull();
        expect(frame?.lines).toHaveLength(5);

        // Line 55
        expect(frame?.lines[0]).toEqual({
            lineNumber: 55,
            code: " const foo = 'bar';",
            isHighlighted: false,
            isMarker: false,
        });

        // Line 57 (highlighted)
        expect(frame?.lines[2]).toEqual({
            lineNumber: 57,
            code: '',
            isHighlighted: true,
            isMarker: false,
        });

        // Marker line
        expect(frame?.lines[3]).toEqual({
            lineNumber: null,
            code: ' ^',
            isHighlighted: false,
            isMarker: true,
        });
    });

    it('parses error message with code frame in the middle', () => {
        const input = `Error: Something went wrong
  55 | const errorHandlerMiddleware = t.middleware(async ({ next }) => {
  56 |     const result = await next();
> 57 |
     | ^
  58 |     return result;
  at Object.<anonymous> (/path/to/file.ts:57:5)`;

        const result = parseStackTrace(input);

        expect(result.segments).toHaveLength(3);

        // First segment: error message
        expect(result.segments[0].type).toBe('text');
        if (result.segments[0].type === 'text') {
            expect(result.segments[0].content).toBe(
                'Error: Something went wrong'
            );
        }

        // Second segment: code frame
        expect(result.segments[1].type).toBe('codeFrame');
        if (result.segments[1].type === 'codeFrame') {
            expect(result.segments[1].frame.lines).toHaveLength(5);
        }

        // Third segment: stack trace
        expect(result.segments[2].type).toBe('text');
        if (result.segments[2].type === 'text') {
            expect(result.segments[2].content).toBe(
                '  at Object.<anonymous> (/path/to/file.ts:57:5)'
            );
        }
    });

    it('handles message with no code frame', () => {
        const input = `Error: Something went wrong
  at Object.<anonymous> (/path/to/file.ts:57:5)
  at Module._compile (node:internal/modules/cjs/loader:1376:14)`;

        const result = parseStackTrace(input);

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].type).toBe('text');
        if (result.segments[0].type === 'text') {
            expect(result.segments[0].content).toBe(input);
        }
    });

    it('handles empty string', () => {
        const result = parseStackTrace('');
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].type).toBe('text');
        if (result.segments[0].type === 'text') {
            expect(result.segments[0].content).toBe('');
        }
    });

    it('parses code frame with ANSI codes in surrounding text', () => {
        const input = `\x1b[36m/path/to/file.ts\x1b[0m:\x1b[33m57\x1b[0m
  55 | const foo = 'bar';
> 56 | throw new Error('test');
     |       ^
  57 | const baz = 'qux';
\x1b[31mError: test\x1b[0m`;

        const result = parseStackTrace(input);

        expect(result.segments).toHaveLength(3);

        // First segment: file path with ANSI
        expect(result.segments[0].type).toBe('text');
        if (result.segments[0].type === 'text') {
            expect(result.segments[0].content).toContain('\x1b[36m');
        }

        // Second segment: code frame
        expect(result.segments[1].type).toBe('codeFrame');
        if (result.segments[1].type === 'codeFrame') {
            expect(result.segments[1].frame.lines).toHaveLength(4);
            expect(result.segments[1].frame.lines[1].isHighlighted).toBe(true);
            expect(result.segments[1].frame.lines[2].isMarker).toBe(true);
        }

        // Third segment: error message with ANSI
        expect(result.segments[2].type).toBe('text');
        if (result.segments[2].type === 'text') {
            expect(result.segments[2].content).toContain('\x1b[31m');
        }
    });

    it('parses multiple consecutive code frames', () => {
        const input = `First error:
   1 | const a = 1;
> 2 | throw a;
     | ^
Second error:
   10 | const b = 2;
> 11 | throw b;
      | ^`;

        const result = parseStackTrace(input);

        // text, codeFrame, text, codeFrame
        expect(result.segments).toHaveLength(4);
        expect(result.segments[0].type).toBe('text');
        expect(result.segments[1].type).toBe('codeFrame');
        expect(result.segments[2].type).toBe('text');
        expect(result.segments[3].type).toBe('codeFrame');
    });

    it('handles code with special characters', () => {
        const input = `  1 | const regex = /\\d+/;
  2 | const html = '<div class="foo">';
> 3 | const json = { "key": "value" };
    | ^`;

        const result = parseStackTrace(input);

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].type).toBe('codeFrame');

        if (result.segments[0].type === 'codeFrame') {
            expect(result.segments[0].frame.lines[0].code).toContain('/\\d+/');
            expect(result.segments[0].frame.lines[1].code).toContain('<div');
            expect(result.segments[0].frame.lines[2].code).toContain('"key"');
        }
    });

    it('parses code frame with ANSI codes in line numbers and code', () => {
        // Real format from tRPC error handler - ANSI codes colorize the frame
        const input = `\x1b[1mTRPCError\x1b[0m: UNAUTHORIZED
    at (server/trpc/init.ts:82:31)

  \x1b[2m80\x1b[0m\x1b[2m | \x1b[0m\x1b[90m// Protected procedure\x1b[0m
  \x1b[2m81\x1b[0m\x1b[2m | \x1b[0m\x1b[1mexport\x1b[0m \x1b[1mconst\x1b[0m protectedProcedure = baseProcedure.use(({ ctx, next }) => {
\x1b[33m>\x1b[0m \x1b[2m82\x1b[0m\x1b[2m | \x1b[0m    \x1b[1mif\x1b[0m (!ctx.session) {
\x1b[2m     | \x1b[0m                       \x1b[33m^\x1b[0m
  \x1b[2m83\x1b[0m\x1b[2m | \x1b[0m        \x1b[1mthrow\x1b[0m \x1b[1mnew\x1b[0m TRPCError({ code: 'UNAUTHORIZED' });
  \x1b[2m84\x1b[0m\x1b[2m | \x1b[0m    }`;

        const result = parseStackTrace(input);

        // Should have: text (error + stack line + blank), codeFrame
        expect(result.segments.length).toBeGreaterThanOrEqual(2);

        // Find the code frame segment
        const codeFrameSegment = result.segments.find(
            (s) => s.type === 'codeFrame'
        );
        expect(codeFrameSegment).toBeDefined();

        if (codeFrameSegment?.type === 'codeFrame') {
            const frame = codeFrameSegment.frame;

            // Should have 6 lines (80, 81, 82, marker, 83, 84)
            expect(frame.lines).toHaveLength(6);

            // Line 80 - comment
            expect(frame.lines[0].lineNumber).toBe(80);
            expect(frame.lines[0].isHighlighted).toBe(false);
            expect(frame.lines[0].code).toContain('// Protected procedure');

            // Line 82 - highlighted error line
            expect(frame.lines[2].lineNumber).toBe(82);
            expect(frame.lines[2].isHighlighted).toBe(true);
            expect(frame.lines[2].code).toContain('if');

            // Marker line
            expect(frame.lines[3].lineNumber).toBeNull();
            expect(frame.lines[3].isMarker).toBe(true);
            expect(frame.lines[3].code).toContain('^');
        }
    });
});
