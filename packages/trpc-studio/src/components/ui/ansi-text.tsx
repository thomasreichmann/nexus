'use client';

import { ansiToHtml, hasAnsi } from '@/lib/ansi';

interface AnsiTextProps {
    children: string;
    className?: string;
}

/**
 * Renders a string with ANSI escape codes as colored HTML
 */
export function AnsiText({ children, className }: AnsiTextProps) {
    if (!hasAnsi(children)) {
        return <span className={className}>{children}</span>;
    }

    return (
        <span
            className={className}
            dangerouslySetInnerHTML={{ __html: ansiToHtml(children) }}
        />
    );
}
