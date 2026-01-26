import { findSourceMap } from 'node:module';
import * as nodeModule from 'node:module';
import pino from 'pino';

export const isDev = process.env.NODE_ENV === 'development';

// Enable source map support in development for better stack traces
// setSourceMapsSupport was added in Node.js 22.14+
if (isDev && 'setSourceMapsSupport' in nodeModule) {
    (nodeModule.setSourceMapsSupport as (enabled: boolean) => void)(true);
}

export type ErrorVerbosity = 'minimal' | 'standard' | 'full';

export const errorVerbosity: ErrorVerbosity = isDev ? 'full' : 'standard';

// V8 stack traces have two formats: named function and anonymous
const STACK_FRAME_REGEX = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

export interface StackFrame {
    functionName?: string;
    filePath: string;
    line: number;
    column: number;
}

export function parseStackFrame(line: string): StackFrame | null {
    const match = line.match(STACK_FRAME_REGEX);
    if (!match) return null;

    return {
        functionName: match[1] || undefined,
        filePath: match[2],
        line: parseInt(match[3], 10),
        column: parseInt(match[4], 10),
    };
}

export function formatStackFrame(frame: StackFrame): string {
    const location = `${frame.filePath}:${frame.line}:${frame.column}`;
    if (frame.functionName) {
        return `    at ${frame.functionName} (${location})`;
    }
    return `    at ${location}`;
}

/**
 * Transforms a stack trace by applying source maps to each frame.
 * Only active in development mode.
 */
export function transformStackTrace(
    stack: string | undefined
): string | undefined {
    if (!stack || !isDev) return stack;

    const lines = stack.split('\n');
    const transformedLines: string[] = [];

    for (const line of lines) {
        const frame = parseStackFrame(line);

        if (!frame) {
            transformedLines.push(line);
            continue;
        }

        const sourceMap = findSourceMap(frame.filePath);
        if (!sourceMap) {
            transformedLines.push(line);
            continue;
        }

        // findOrigin returns {} if no mapping found
        const origin = sourceMap.findOrigin(frame.line, frame.column) as
            | { source: string; line: number; column: number; name?: string }
            | undefined;
        if (!origin || !origin.source) {
            transformedLines.push(line);
            continue;
        }

        const transformedFrame: StackFrame = {
            functionName: origin.name || frame.functionName,
            filePath: origin.source,
            line: origin.line,
            column: origin.column,
        };

        transformedLines.push(formatStackFrame(transformedFrame));
    }

    return transformedLines.join('\n');
}

const transport = isDev
    ? {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true },
      }
    : undefined;

export const logger = pino({
    level: isDev ? 'debug' : 'info',
    transport,
});
