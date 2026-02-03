/**
 * A single line within a code frame
 */
export interface CodeFrameLine {
    /** Line number, or null for marker lines (^ indicator) */
    lineNumber: number | null;
    /** The actual code content */
    code: string;
    /** Whether this line has the > prefix (the error line) */
    isHighlighted: boolean;
    /** Whether this is a ^ indicator line */
    isMarker: boolean;
}

/**
 * A code frame extracted from an error stack trace
 */
export interface CodeFrame {
    lines: CodeFrameLine[];
}

/**
 * A segment of a parsed stack trace - either plain text or a code frame
 */
export type StackTraceSegment =
    | { type: 'text'; content: string }
    | { type: 'codeFrame'; frame: CodeFrame };

/**
 * The result of parsing a stack trace
 */
export interface ParsedStackTrace {
    segments: StackTraceSegment[];
}

/**
 * Strip ANSI escape codes from a string.
 * Code frames from some error formatters include ANSI codes for coloring.
 */
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
    return str.replace(ANSI_REGEX, '');
}

/**
 * Regex to match code frame lines:
 * - Optional > prefix (highlighted line)
 * - Optional line number
 * - Pipe separator |
 * - Code content
 *
 * Examples:
 *   "  55 | const foo = ..." → lineNumber: 55, isHighlighted: false
 *   "> 57 | const bar = ..." → lineNumber: 57, isHighlighted: true
 *   "     | ^" → lineNumber: null, isMarker: true
 */
const CODE_FRAME_LINE_REGEX = /^(\s*)(>)?(\s*)(\d+)?(\s*)\|(.*)$/;

/**
 * Check if a line looks like part of a code frame.
 * Strips ANSI codes first since some formatters colorize the frame.
 */
function isCodeFrameLine(line: string): boolean {
    return CODE_FRAME_LINE_REGEX.test(stripAnsi(line));
}

/**
 * Parse a single line that matches the code frame pattern.
 * Strips ANSI codes to extract structure, since we'll apply Prism highlighting.
 */
function parseCodeFrameLine(line: string): CodeFrameLine | null {
    // Strip ANSI codes for pattern matching and code extraction
    const cleanLine = stripAnsi(line);
    const match = cleanLine.match(CODE_FRAME_LINE_REGEX);
    if (!match) return null;

    const [, , marker, , lineNumStr, , codeContent] = match;
    const isHighlighted = marker === '>';
    const lineNumber = lineNumStr ? parseInt(lineNumStr, 10) : null;
    const code = codeContent ?? '';

    // Check if this is a marker line (contains only ^ and spaces)
    const isMarker = lineNumber === null && /^\s*\^+\s*$/.test(code);

    return {
        lineNumber,
        code,
        isHighlighted,
        isMarker,
    };
}

/**
 * Parse an error message to identify and extract code frame sections.
 *
 * Code frames are the formatted code snippets that show context around an error,
 * typically produced by tools like esbuild, webpack, or Node.js.
 *
 * Example input:
 * ```
 * Error: Something went wrong
 *   55 | const errorHandlerMiddleware = t.middleware(async ({ next }) => {
 *   56 |     const result = await next();
 * > 57 |
 *      | ^
 *   58 |     return result;
 *   at Object.<anonymous> (/path/to/file.ts:57:5)
 * ```
 */
export function parseStackTrace(message: string): ParsedStackTrace {
    const lines = message.split('\n');
    const segments: StackTraceSegment[] = [];

    let currentTextLines: string[] = [];
    let currentCodeFrameLines: CodeFrameLine[] = [];

    const flushText = () => {
        if (currentTextLines.length > 0) {
            segments.push({
                type: 'text',
                content: currentTextLines.join('\n'),
            });
            currentTextLines = [];
        }
    };

    const flushCodeFrame = () => {
        if (currentCodeFrameLines.length > 0) {
            segments.push({
                type: 'codeFrame',
                frame: { lines: currentCodeFrameLines },
            });
            currentCodeFrameLines = [];
        }
    };

    for (const line of lines) {
        if (isCodeFrameLine(line)) {
            // We're in or entering a code frame
            flushText();
            const parsed = parseCodeFrameLine(line);
            if (parsed) {
                currentCodeFrameLines.push(parsed);
            }
        } else {
            // We're in regular text
            flushCodeFrame();
            currentTextLines.push(line);
        }
    }

    // Flush any remaining content
    flushText();
    flushCodeFrame();

    return { segments };
}
