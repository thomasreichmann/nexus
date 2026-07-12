'use client';

import * as React from 'react';

/**
 * Copy text to the clipboard with a transient "copied" flag for UI feedback.
 * The flag resets after `timeoutMs` (re-copying restarts the timer).
 */
export function useCopyToClipboard(timeoutMs = 2000): {
    isCopied: boolean;
    copy: (text: string) => void;
} {
    const [isCopied, setIsCopied] = React.useState(false);
    const timeoutRef = React.useRef<number | undefined>(undefined);

    React.useEffect(() => {
        return () => window.clearTimeout(timeoutRef.current);
    }, []);

    const copy = React.useCallback(
        (text: string) => {
            navigator.clipboard.writeText(text);
            setIsCopied(true);
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = window.setTimeout(
                () => setIsCopied(false),
                timeoutMs
            );
        },
        [timeoutMs]
    );

    return { isCopied, copy };
}
