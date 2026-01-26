import { toRelativePath, type StackTraceConfig } from '../config';
import { buildCodeFrame, formatCodeFrame } from './codeframe';
import {
    collapseFrames,
    extractFrameInfo,
    isCollapsedMarker,
    type FrameInfo,
} from './frames';
import { createColorFunctions, type ColorFunctions } from './highlight';
import { wrapWithHyperlink } from './hyperlink';
import { mapCallSites } from './mapping';

function formatFrameLine(
    frame: FrameInfo,
    projectRoot: string,
    colors: ColorFunctions,
    hyperlinkEnabled: boolean
): string {
    const relativePath = toRelativePath(frame.file, projectRoot);
    const location = `${relativePath}:${frame.line}:${frame.column}`;

    const linkedLocation = wrapWithHyperlink(
        frame.file,
        frame.line,
        frame.column,
        colors.cyan(location),
        hyperlinkEnabled
    );

    const asyncPrefix = frame.isAsync ? colors.dim('async ') : '';
    const functionPart = frame.functionName
        ? colors.bold(frame.functionName) + ' '
        : '';

    return `    at ${asyncPrefix}${functionPart}(${linkedLocation})`;
}

function formatCollapsedMarker(
    count: number,
    kind: 'project' | 'vendor',
    colors: ColorFunctions
): string {
    const label = kind === 'project' ? 'project' : '';
    const suffix = count > 1 ? 's' : '';
    const text = label
        ? `${count} more ${label} frame${suffix}`
        : `${count} frame${suffix} hidden`;
    return `    ${colors.dim(`… ${text} …`)}`;
}

export function formatStackTrace(
    error: Error,
    rawFrames: NodeJS.CallSite[],
    config: StackTraceConfig
): string {
    const colors = createColorFunctions(config.colorEnabled);

    // Map call sites through source maps
    const mappedFrames = mapCallSites(rawFrames, config.projectRoot);

    // Extract frame info
    const frameInfos = mappedFrames
        .map((cs) => extractFrameInfo(cs, config.projectRoot))
        .filter((f) => f.file !== '<anonymous>');

    // Collapse frames based on config
    const collapsed = collapseFrames(frameInfos, {
        maxProjectFrames: config.maxProjectFrames,
        showVendor: config.showVendor,
    });

    // Format header
    const lines: string[] = [`${colors.bold(error.name)}: ${error.message}`];

    // Track first project frame for code frame
    let codeFrameOutput: string[] | null = null;

    // Format each frame or marker
    for (const item of collapsed) {
        if (isCollapsedMarker(item)) {
            lines.push(formatCollapsedMarker(item.count, item.kind, colors));
        } else {
            lines.push(
                formatFrameLine(
                    item,
                    config.projectRoot,
                    colors,
                    config.colorEnabled
                )
            );

            // Generate code frame for first project frame
            if (!codeFrameOutput && item.kind === 'project') {
                const frame = buildCodeFrame(
                    item.file,
                    item.line,
                    item.column,
                    config.codeFrameContext
                );
                if (frame) {
                    codeFrameOutput = formatCodeFrame(frame, colors);
                }
            }
        }
    }

    // Append code frame at the end
    if (codeFrameOutput && codeFrameOutput.length > 0) {
        lines.push('');
        lines.push(...codeFrameOutput);
    }

    return lines.join('\n');
}
