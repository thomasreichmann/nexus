import fs from 'node:fs';
import {
    findSourceMap as findSourceMapCjs,
    SourceMap as NodeSourceMap,
} from 'node:module';
import type { SourceMapPayload, SourceMapping } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MappedPosition {
    file: string;
    line: number;
    column: number;
}

const sourceMapCache = new Map<string, NodeSourceMap | null>();
const positionCache = new Map<string, MappedPosition | null>();

function toAbsolutePath(p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(p);
}

function normalizeSourcePath(source: string, projectRoot: string): string {
    // Handle file:// URLs
    if (source.startsWith('file://')) {
        try {
            return fileURLToPath(source);
        } catch {
            // Fall through to other handling
        }
    }

    // Handle scheme prefixes (webpack://, etc.)
    const schemeIdx = source.indexOf('://');
    if (schemeIdx > 0) {
        source = source.slice(schemeIdx + 3);
        while (source.startsWith('/')) {
            source = source.slice(1);
        }
        source = '/' + source;
    }

    // Handle Turbopack's [project]/ prefix
    if (source.startsWith('[project]/')) {
        source = path.join(projectRoot, source.slice('[project]/'.length));
    }

    // Make relative paths absolute
    if (!path.isAbsolute(source)) {
        source = path.join(projectRoot, source);
    }

    return path.normalize(source);
}

function shouldAttemptMapping(
    file: string | null,
    projectRoot: string
): boolean {
    if (!file) return false;
    const abs = toAbsolutePath(file);

    // Map Turbopack chunks in .next/server/chunks
    if (
        abs.includes(`${path.sep}.next${path.sep}`) &&
        abs.includes(`${path.sep}server${path.sep}`) &&
        abs.includes(`${path.sep}chunks${path.sep}`)
    ) {
        return true;
    }

    // Don't remap already-original project files
    if (
        abs.startsWith(projectRoot) &&
        !abs.includes(`${path.sep}.next${path.sep}`)
    ) {
        return false;
    }

    return false;
}

function tryLoadSourceMap(absFile: string): NodeSourceMap | null {
    let code: string;
    try {
        code = fs.readFileSync(absFile, 'utf8');
    } catch {
        return null;
    }

    // Find sourceMappingURL comment (use last occurrence)
    const regex = /\/\/[#@]\s*sourceMappingURL=([^\s]+)/g;
    let match: RegExpExecArray | null;
    let url: string | null = null;
    while ((match = regex.exec(code)) !== null) {
        url = match[1];
    }
    if (!url) return null;

    try {
        // Handle inline data URLs
        if (url.startsWith('data:')) {
            const comma = url.indexOf(',');
            if (comma === -1) return null;
            const meta = url.slice(5, comma);
            const data = url.slice(comma + 1);
            const isBase64 = /;base64/i.test(meta);
            const jsonStr = isBase64
                ? Buffer.from(data, 'base64').toString('utf8')
                : decodeURIComponent(data);
            const json = JSON.parse(jsonStr) as SourceMapPayload;
            return new NodeSourceMap(json);
        }

        // Handle external source map files
        const resolvedPath = url.startsWith('file://')
            ? fileURLToPath(url)
            : path.isAbsolute(url)
              ? url
              : path.resolve(path.dirname(absFile), url);

        // Try both encoded and decoded paths
        const decodedUrl = (() => {
            try {
                return decodeURIComponent(url);
            } catch {
                return url;
            }
        })();
        const decodedPath = decodedUrl.startsWith('file://')
            ? fileURLToPath(decodedUrl)
            : path.isAbsolute(decodedUrl)
              ? decodedUrl
              : path.resolve(path.dirname(absFile), decodedUrl);

        for (const candidate of [decodedPath, resolvedPath]) {
            try {
                const json = JSON.parse(
                    fs.readFileSync(candidate, 'utf8')
                ) as SourceMapPayload;
                return new NodeSourceMap(json);
            } catch {
                // Try next candidate
            }
        }
        return null;
    } catch {
        return null;
    }
}

function findSourceMap(file: string | null): NodeSourceMap | null {
    if (!file) return null;
    const abs = toAbsolutePath(file);

    if (sourceMapCache.has(abs)) {
        return sourceMapCache.get(abs) ?? null;
    }

    // Try Node.js built-in first
    const builtinResult = findSourceMapCjs(abs);
    let sourceMap: NodeSourceMap | null =
        (builtinResult as unknown as NodeSourceMap) ?? null;

    // Fall back to manual loading
    if (!sourceMap) {
        sourceMap = tryLoadSourceMap(abs);
    }

    sourceMapCache.set(abs, sourceMap);
    return sourceMap;
}

export function mapPosition(
    file: string,
    line: number,
    column: number,
    projectRoot: string
): MappedPosition | null {
    const cacheKey = `${file}:${line}:${column}`;

    if (positionCache.has(cacheKey)) {
        return positionCache.get(cacheKey) ?? null;
    }

    if (!shouldAttemptMapping(file, projectRoot)) {
        positionCache.set(cacheKey, null);
        return null;
    }

    const sourceMap = findSourceMap(file);
    if (!sourceMap) {
        positionCache.set(cacheKey, null);
        return null;
    }

    // Source maps use 0-based columns
    const column0 = Math.max(0, column - 1);
    let entry = sourceMap.findEntry(line, column0) as SourceMapping | null;

    // Retry with original column if needed
    if (!entry?.originalSource || !entry?.originalLine) {
        entry = sourceMap.findEntry(line, column) as SourceMapping | null;
    }

    if (!entry?.originalSource || !entry?.originalLine) {
        positionCache.set(cacheKey, null);
        return null;
    }

    const result: MappedPosition = {
        file: normalizeSourcePath(entry.originalSource, projectRoot),
        line: entry.originalLine,
        column: (entry.originalColumn ?? 0) + 1,
    };

    positionCache.set(cacheKey, result);
    return result;
}

export function mapCallSite(
    callSite: NodeJS.CallSite,
    projectRoot: string
): NodeJS.CallSite {
    const file =
        callSite.getFileName?.() ??
        callSite.getScriptNameOrSourceURL?.() ??
        null;
    const line = callSite.getLineNumber?.() ?? null;
    const column = callSite.getColumnNumber?.() ?? null;

    if (!file || line === null || column === null) {
        return callSite;
    }

    const mapped = mapPosition(file, line, column, projectRoot);
    if (!mapped) {
        return callSite;
    }

    // Return a proxy that overrides position getters
    return new Proxy(callSite, {
        get(target, prop, receiver) {
            if (prop === 'getFileName' || prop === 'getScriptNameOrSourceURL') {
                return () => mapped.file;
            }
            if (prop === 'getLineNumber') {
                return () => mapped.line;
            }
            if (prop === 'getColumnNumber') {
                return () => mapped.column;
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

export function mapCallSites(
    callSites: NodeJS.CallSite[],
    projectRoot: string
): NodeJS.CallSite[] {
    return callSites.map((cs) => mapCallSite(cs, projectRoot));
}
