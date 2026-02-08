import path from 'node:path';

export interface StackTraceConfig {
    /** Whether stack trace mapping is enabled (dev-only) */
    enabled: boolean;
    /** Project root directory for relative path display */
    projectRoot: string;
    /** Whether terminal colors are enabled */
    colorEnabled: boolean;
    /** Maximum project frames to show before collapsing */
    maxProjectFrames: number;
    /** Whether to show vendor/node_modules frames */
    showVendor: boolean;
    /** Whether to show collapsed frame markers ("… x frames hidden …") */
    showMarkers: boolean;
    /** Lines of code context to show around error location */
    codeFrameContext: number;
}

function detectColorSupport(): boolean {
    if (process.env.STACKTRACE_COLOR === '0') return false;
    if (process.env.STACKTRACE_COLOR === '1') return true;
    if (process.env.FORCE_COLOR === '0') return false;
    return !!process.stdout?.isTTY;
}

function parseIntEnv(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        console.warn(
            `[stacktrace] Invalid value for ${key}: "${value}" (expected integer, using default: ${defaultValue})`
        );
        return defaultValue;
    }
    return parsed;
}

export function loadConfig(): StackTraceConfig {
    return {
        enabled: process.env.NODE_ENV === 'development',
        projectRoot: process.cwd(),
        colorEnabled: detectColorSupport(),
        maxProjectFrames: parseIntEnv('STACKTRACE_MAX_PROJECT', 10),
        showVendor: process.env.STACKTRACE_SHOW_VENDOR === '1',
        showMarkers: process.env.STACKTRACE_SHOW_MARKERS === '1',
        codeFrameContext: parseIntEnv('STACKTRACE_CODEFRAME_CONTEXT', 2),
    };
}

let cachedConfig: StackTraceConfig | null = null;

export function getConfig(): StackTraceConfig {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }
    return cachedConfig;
}

export function toRelativePath(
    absolutePath: string,
    projectRoot: string
): string {
    if (absolutePath.startsWith(projectRoot + path.sep)) {
        return absolutePath.slice(projectRoot.length + 1);
    }
    return absolutePath;
}
