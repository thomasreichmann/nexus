import { getConfig } from '../config';
import { formatStackTrace } from './format';

// Global flag to prevent double-installation on hot reload
const globalKey = Symbol.for('nexus.stacktraceMapperInstalled');
const g = globalThis as typeof globalThis & { [globalKey]?: boolean };

/**
 * Generate a basic stack trace using V8's default format.
 * Used as fallback when our custom formatting fails.
 */
function defaultStackTrace(error: Error, frames: NodeJS.CallSite[]): string {
    const lines = [`${error.name}: ${error.message}`];
    for (const frame of frames) {
        const file = frame.getFileName?.() ?? '<anonymous>';
        const line = frame.getLineNumber?.() ?? 0;
        const column = frame.getColumnNumber?.() ?? 0;
        const fn = frame.getFunctionName?.() ?? '<anonymous>';
        lines.push(`    at ${fn} (${file}:${line}:${column})`);
    }
    return lines.join('\n');
}

export function installStackTraceMapper(): void {
    const config = getConfig();

    // Only install in development
    if (!config.enabled) {
        return;
    }

    // Prevent double-installation
    if (g[globalKey]) {
        return;
    }
    g[globalKey] = true;

    Error.prepareStackTrace = (error, structuredStackTrace) => {
        const frames = Array.isArray(structuredStackTrace)
            ? structuredStackTrace
            : [];
        try {
            return formatStackTrace(error, frames, config);
        } catch (formatError) {
            // Log the formatting error for debugging
            console.warn(
                '[stacktrace] Formatting failed, using fallback:',
                formatError
            );
            // Fallback to basic V8-style format that preserves stack info
            return defaultStackTrace(error, frames);
        }
    };
}

// Auto-install when module is imported
installStackTraceMapper();
