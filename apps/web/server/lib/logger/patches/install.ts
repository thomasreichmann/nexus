import { getConfig } from '../config';
import { formatStackTrace } from './format';

// Global flag to prevent double-installation on hot reload
const globalKey = Symbol.for('nexus.stacktraceMapperInstalled');
const g = globalThis as typeof globalThis & { [globalKey]?: boolean };

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
        try {
            const frames = Array.isArray(structuredStackTrace)
                ? structuredStackTrace
                : [];
            return formatStackTrace(error, frames, config);
        } catch {
            // Fallback to simple format if formatting fails
            return `${error.name}: ${error.message}`;
        }
    };
}

// Auto-install when module is imported
installStackTraceMapper();
