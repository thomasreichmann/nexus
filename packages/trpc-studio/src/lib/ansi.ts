import { AnsiUp } from 'ansi_up';

// Singleton instance for consistent state tracking
const ansiUp = new AnsiUp();
ansiUp.use_classes = true;

/**
 * Check if a string contains ANSI escape codes
 */
export function hasAnsi(str: string): boolean {
    // eslint-disable-next-line no-control-regex
    return /\x1b\[/.test(str);
}

/**
 * Convert ANSI escape codes to HTML with CSS classes
 */
export function ansiToHtml(str: string): string {
    return ansiUp.ansi_to_html(str);
}
