'use client';

import * as React from 'react';
import { parseStackTrace } from '@/lib/stack-trace';
import { AnsiText } from '@/components/ui/ansi-text';
import { CodeFrame } from '@/components/ui/code-frame';
import { cn } from '@/lib/utils';

interface HighlightedStackTraceProps {
    message: string;
    className?: string;
}

/**
 * Renders an error message with syntax highlighting for code frames.
 * Non-code portions are rendered with ANSI color support.
 */
export function HighlightedStackTrace({
    message,
    className,
}: HighlightedStackTraceProps) {
    const parsed = React.useMemo(() => parseStackTrace(message), [message]);

    return (
        <span className={cn('block', className)}>
            {parsed.segments.map((segment, i) =>
                segment.type === 'text' ? (
                    <AnsiText key={i}>{segment.content}</AnsiText>
                ) : (
                    <CodeFrame key={i} frame={segment.frame} />
                )
            )}
        </span>
    );
}
