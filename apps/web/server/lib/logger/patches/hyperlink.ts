// Terminal hyperlink utilities.
// Currently disabled - just returns plain text.
// See GitHub issue for future implementation considerations.

/**
 * Wrap text that could be a hyperlink.
 * Currently returns plain text without any linking.
 */
export function wrapWithHyperlink(
    _filePath: string,
    _line: number,
    _column: number,
    displayText: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _enabled: boolean
): string {
    return displayText;
}
