import path from 'node:path';
import { getConfig, toRelativePath } from './config';
import {
    classifyFile,
    type ExtendedCallSite,
    type FrameKind,
} from './patches/frames';
import { mapCallSites } from './patches/mapping';
import { safeGet } from './patches/utils';

export interface LogOrigin {
    /** Absolute file path (for clickable terminals) */
    absPath: string;
    /** Project-relative path (for display) */
    relPath: string;
    /** Line number */
    line: number;
    /** Column number */
    column: number;
    /** Function name if available */
    functionName: string | null;
    /** Whether this is an async function */
    isAsync: boolean;
    /** Frame classification */
    kind: FrameKind;
}

export interface CaptureOriginOptions {
    /** Additional frames to skip from the top */
    extraSkip?: number;
    /** Allow falling back to vendor frames if no project frame found */
    allowVendorFallback?: boolean;
}

function isSkippedFile(file: string): boolean {
    const abs = path.isAbsolute(file) ? file : path.resolve(file);

    // Skip logger internals (but not __dev__ test files)
    const isLoggerInternals =
        /[\\/]server[\\/]lib[\\/]logger[\\/]/.test(abs) &&
        !/[\\/]__dev__[\\/]/.test(abs);

    // Skip pino internals
    const isPino = /[\\/]node_modules[\\/]pino/.test(abs);
    const isPinoPretty = /[\\/]node_modules[\\/]pino-pretty/.test(abs);

    return isLoggerInternals || isPino || isPinoPretty;
}

function getStructuredFrames(error: Error): NodeJS.CallSite[] {
    const originalPrepare = Error.prepareStackTrace;
    let frames: NodeJS.CallSite[] = [];

    Error.prepareStackTrace = (_, structured) => {
        frames = Array.isArray(structured) ? structured : [];
        return '';
    };

    // Trigger stack capture
    void error.stack;

    Error.prepareStackTrace = originalPrepare;
    return frames;
}

export function captureLogOrigin(
    opts?: CaptureOriginOptions
): LogOrigin | null {
    const config = getConfig();

    // Skip in production
    if (!config.enabled) {
        return null;
    }

    try {
        const error = new Error();
        Error.captureStackTrace(error, captureLogOrigin);

        const rawFrames = getStructuredFrames(error);
        const skipCount = 1 + (opts?.extraSkip ?? 0);
        const relevantFrames = rawFrames.slice(skipCount);

        // Map frames through source maps
        const mappedFrames = mapCallSites(relevantFrames, config.projectRoot);

        for (const rawCs of mappedFrames) {
            const cs = rawCs as ExtendedCallSite;
            const file = safeGet(
                () => cs.getFileName?.() ?? cs.getScriptNameOrSourceURL?.(),
                null
            );
            if (!file) continue;
            if (isSkippedFile(file)) continue;

            const kind = classifyFile(file, config.projectRoot);

            // Only return project frames (or vendor if fallback allowed)
            if (
                kind !== 'project' &&
                !(opts?.allowVendorFallback && kind === 'vendor')
            ) {
                continue;
            }

            const abs = path.isAbsolute(file) ? file : path.resolve(file);
            const rel = toRelativePath(abs, config.projectRoot);
            const line = safeGet(() => cs.getLineNumber?.(), 0);
            const column = safeGet(() => cs.getColumnNumber?.(), 0);
            const functionName = safeGet(
                () => cs.getFunctionName?.() ?? cs.getMethodName?.(),
                null
            );
            const isAsync = safeGet(() => cs.isAsync() ?? false, false);

            return {
                absPath: abs,
                relPath: rel,
                line,
                column,
                functionName,
                isAsync,
                kind,
            };
        }

        return null;
    } catch {
        return null;
    }
}

export function formatOrigin(origin: LogOrigin): string {
    return `${origin.relPath}:${origin.line}:${origin.column}`;
}
