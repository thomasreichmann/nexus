import fs from 'node:fs';
import path from 'node:path';
import { type ColorFunctions, highlightLine } from './highlight';
import { evictOldEntries } from './utils';

// Cache file contents to avoid repeated disk reads for same files
const fileContentCache = new Map<string, string>();
const MAX_FILE_CACHE = 50;

export interface CodeLine {
    lineNumber: number;
    content: string;
    isTarget: boolean;
}

export interface CodeFrame {
    lines: CodeLine[];
    targetLine: number;
    targetColumn: number;
}

export function buildCodeFrame(
    file: string,
    line: number,
    column: number,
    contextLines: number
): CodeFrame | null {
    const abs = path.isAbsolute(file) ? file : path.resolve(file);

    let contents: string;
    if (fileContentCache.has(abs)) {
        contents = fileContentCache.get(abs)!;
    } else {
        try {
            contents = fs.readFileSync(abs, 'utf8');
            fileContentCache.set(abs, contents);
            evictOldEntries(fileContentCache, MAX_FILE_CACHE);
        } catch {
            return null;
        }
    }

    const allLines = contents.split(/\r?\n/);
    if (line <= 0 || line > allLines.length) {
        return null;
    }

    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(allLines.length, line + contextLines);

    const lines: CodeLine[] = [];
    for (let i = startLine; i <= endLine; i++) {
        lines.push({
            lineNumber: i,
            content: allLines[i - 1] ?? '',
            isTarget: i === line,
        });
    }

    return {
        lines,
        targetLine: line,
        targetColumn: column,
    };
}

export function formatCodeFrame(
    frame: CodeFrame,
    colors: ColorFunctions
): string[] {
    const output: string[] = [];
    const lineNumWidth = String(
        frame.lines[frame.lines.length - 1]?.lineNumber ?? 0
    ).length;

    for (const line of frame.lines) {
        const marker = line.isTarget ? colors.yellow('>') : ' ';
        const lineNum = String(line.lineNumber).padStart(lineNumWidth, ' ');
        const pipe = colors.dim(' | ');
        const highlighted = highlightLine(line.content, colors);

        output.push(`${marker} ${colors.dim(lineNum)}${pipe}${highlighted}`);

        // Add column indicator for target line
        if (line.isTarget && frame.targetColumn > 0) {
            const prefix = `  ${' '.repeat(lineNumWidth)} | `;
            // Account for tabs - expand to 2 spaces each
            const preColumn = line.content.slice(
                0,
                Math.max(0, frame.targetColumn - 1)
            );
            const spaces = preColumn.replace(/\t/g, '  ').length;
            output.push(
                `${colors.dim(prefix)}${' '.repeat(spaces)}${colors.yellow('^')}`
            );
        }
    }

    return output;
}
