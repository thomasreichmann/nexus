import path from 'node:path';
import { safeGet } from './utils';

export type FrameKind = 'project' | 'vendor' | 'internal';

export interface FrameInfo {
    file: string;
    line: number;
    column: number;
    functionName: string | null;
    isAsync: boolean;
    kind: FrameKind;
}

export interface CollapsedMarker {
    type: 'collapsed';
    count: number;
    kind: 'project' | 'vendor';
}

export type FrameOrMarker = FrameInfo | CollapsedMarker;

export function isCollapsedMarker(
    frame: FrameOrMarker
): frame is CollapsedMarker {
    return 'type' in frame && frame.type === 'collapsed';
}

export function classifyFile(
    file: string | null,
    projectRoot: string
): FrameKind {
    if (!file) return 'internal';

    // Node built-in modules
    if (file.startsWith('node:')) {
        return 'internal';
    }

    const abs = path.isAbsolute(file) ? file : path.resolve(file);

    // Internal Node paths
    if (
        abs.includes(`${path.sep}node${path.sep}internal${path.sep}`) ||
        abs.includes(`${path.sep}internal${path.sep}`)
    ) {
        return 'internal';
    }

    // .next internals (server runtime, not chunks)
    if (abs.includes(`${path.sep}.next${path.sep}`)) {
        // Chunks that have been source-mapped back are project files
        if (!abs.includes(`${path.sep}chunks${path.sep}`)) {
            return 'internal';
        }
    }

    // node_modules = vendor
    if (abs.includes(`${path.sep}node_modules${path.sep}`)) {
        return 'vendor';
    }

    // Files under project root are project files
    if (abs.startsWith(projectRoot)) {
        return 'project';
    }

    return 'internal';
}

export function extractFrameInfo(
    callSite: NodeJS.CallSite,
    projectRoot: string
): FrameInfo {
    const file = safeGet(
        () => callSite.getFileName?.() ?? callSite.getScriptNameOrSourceURL?.(),
        '<anonymous>'
    );
    const line = safeGet(() => callSite.getLineNumber?.(), 0);
    const column = safeGet(() => callSite.getColumnNumber?.(), 0);
    const functionName = safeGet(
        () => callSite.getFunctionName?.() ?? callSite.getMethodName?.(),
        null
    );
    const isAsync = safeGet(
        () => (callSite as { isAsync?: () => boolean }).isAsync?.() ?? false,
        false
    );

    return {
        file,
        line,
        column,
        functionName,
        isAsync,
        kind: classifyFile(file, projectRoot),
    };
}

export interface CollapseConfig {
    maxProjectFrames: number;
    showVendor: boolean;
}

export function collapseFrames(
    frames: FrameInfo[],
    config: CollapseConfig
): FrameOrMarker[] {
    const result: FrameOrMarker[] = [];
    let i = 0;

    while (i < frames.length) {
        const frame = frames[i];

        // Always skip internal frames
        if (frame.kind === 'internal') {
            i++;
            continue;
        }

        // Handle project frames
        if (frame.kind === 'project') {
            let kept = 0;
            while (
                i < frames.length &&
                frames[i].kind === 'project' &&
                kept < config.maxProjectFrames
            ) {
                result.push(frames[i]);
                i++;
                kept++;
            }

            // Count remaining project frames
            let extra = 0;
            while (i < frames.length && frames[i].kind === 'project') {
                i++;
                extra++;
            }

            if (extra > 0) {
                result.push({
                    type: 'collapsed',
                    count: extra,
                    kind: 'project',
                });
            }
            continue;
        }

        // Handle vendor frames
        if (frame.kind === 'vendor') {
            if (config.showVendor) {
                result.push(frame);
                i++;
            } else {
                let count = 0;
                while (i < frames.length && frames[i].kind === 'vendor') {
                    i++;
                    count++;
                }
                if (count > 0) {
                    result.push({ type: 'collapsed', count, kind: 'vendor' });
                }
            }
            continue;
        }

        // Fallback for any other case
        i++;
    }

    return result;
}
