'use client';

import * as React from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import type { CodeFrame as CodeFrameType } from '@/lib/stack-trace';
import { getPrismColorClass } from '@/lib/prism-colors';
import { cn } from '@/lib/utils';

interface CodeFrameProps {
    frame: CodeFrameType;
    className?: string;
}

/**
 * Renders a code frame with syntax highlighting.
 * Preserves line numbers, > markers for highlighted lines,
 * and ^ position indicators.
 */
export function CodeFrame({ frame, className }: CodeFrameProps) {
    // Extract just the code content for Prism highlighting
    // Filter out marker lines since they don't contain real code
    const codeLines = frame.lines.filter((l) => !l.isMarker);
    const code = codeLines.map((l) => l.code).join('\n');

    // Build a map from code line index to original frame line
    const lineIndexToFrameLine = new Map<number, (typeof frame.lines)[0]>();
    let codeLineIndex = 0;
    for (const line of frame.lines) {
        if (!line.isMarker) {
            lineIndexToFrameLine.set(codeLineIndex, line);
            codeLineIndex++;
        }
    }

    // Track which marker lines follow which code lines
    const markersAfterLine = new Map<number, (typeof frame.lines)[0][]>();
    let lastCodeLineIndex = -1;
    for (const line of frame.lines) {
        if (line.isMarker) {
            const markers = markersAfterLine.get(lastCodeLineIndex) ?? [];
            markers.push(line);
            markersAfterLine.set(lastCodeLineIndex, markers);
        } else {
            lastCodeLineIndex++;
        }
    }

    return (
        <Highlight theme={themes.vsDark} code={code} language="typescript">
            {({ tokens, getTokenProps }) => (
                <span className={cn('block', className)}>
                    {tokens.map((lineTokens, lineIndex) => {
                        const frameLine = lineIndexToFrameLine.get(lineIndex);
                        const markers = markersAfterLine.get(lineIndex) ?? [];
                        const isHighlighted = frameLine?.isHighlighted ?? false;
                        const lineNumber = frameLine?.lineNumber;

                        // Calculate the width for line number column
                        // Use the max line number for consistent alignment
                        const maxLineNum = Math.max(
                            ...frame.lines
                                .filter((l) => l.lineNumber !== null)
                                .map((l) => l.lineNumber!)
                        );
                        const lineNumWidth = String(maxLineNum).length;

                        return (
                            <React.Fragment key={lineIndex}>
                                {/* Code line */}
                                <span
                                    className={cn(
                                        'block',
                                        isHighlighted && 'bg-red-900/30'
                                    )}
                                >
                                    {/* Highlight marker */}
                                    <span className="text-red-400">
                                        {isHighlighted ? '>' : ' '}
                                    </span>
                                    {/* Line number */}
                                    <span className="text-gray-500 select-none">
                                        {lineNumber !== null
                                            ? ` ${String(lineNumber).padStart(lineNumWidth, ' ')} `
                                            : ` ${' '.repeat(lineNumWidth)} `}
                                    </span>
                                    <span className="text-gray-600">|</span>
                                    {/* Highlighted code */}
                                    {lineTokens.map((token, tokenIndex) => {
                                        const props = getTokenProps({ token });
                                        const colorClass = getPrismColorClass(
                                            token.types
                                        );
                                        return (
                                            <span
                                                key={tokenIndex}
                                                {...props}
                                                className={colorClass}
                                                style={undefined}
                                            />
                                        );
                                    })}
                                </span>

                                {/* Marker lines (^ indicators) that follow this code line */}
                                {markers.map((marker, markerIndex) => (
                                    <span
                                        key={`marker-${markerIndex}`}
                                        className="block"
                                    >
                                        <span className="text-red-400"> </span>
                                        <span className="text-gray-500 select-none">
                                            {` ${' '.repeat(lineNumWidth)} `}
                                        </span>
                                        <span className="text-gray-600">|</span>
                                        <span className="text-red-400">
                                            {marker.code}
                                        </span>
                                    </span>
                                ))}
                            </React.Fragment>
                        );
                    })}
                </span>
            )}
        </Highlight>
    );
}
