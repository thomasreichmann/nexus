'use client';

import * as React from 'react';

/**
 * Whether the user is on an Apple platform (macOS/iOS), so keyboard
 * shortcut hints show "⌘" instead of "Ctrl".
 */
export function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/**
 * Hydration-safe platform detection: returns false until mounted (matching
 * the server render), then the real value. Same pattern as useIsMobile.
 */
export function useIsApplePlatform(): boolean {
    const [isApple, setIsApple] = React.useState(false);

    React.useEffect(() => {
        setIsApple(isApplePlatform());
    }, []);

    return isApple;
}

/**
 * Format a shortcut for display, e.g. formatShortcut('K', { isApple: true })
 * → "⌘K"; with isApple false → "Ctrl+K".
 */
export function formatShortcut(
    key: string,
    options: { isApple: boolean; isShift?: boolean }
): string {
    if (options.isApple) {
        return `⌘${options.isShift ? '⇧' : ''}${key}`;
    }
    return `Ctrl+${options.isShift ? 'Shift+' : ''}${key}`;
}
