// Terminal hyperlink utilities using OSC 8 escape sequences.
// Supported by most modern terminals (iTerm2, VS Code, Windows Terminal, etc.)

export function fileHyperlink(
    filePath: string,
    line: number,
    column: number,
    displayText: string
): string {
    // file:// protocol with line:column for editor integration
    const url = `file://${filePath}:${line}:${column}`;

    // OSC 8 hyperlink format: \x1b]8;;URL\x1b\\TEXT\x1b]8;;\x1b\\
    return `\x1b]8;;${url}\x1b\\${displayText}\x1b]8;;\x1b\\`;
}

export function wrapWithHyperlink(
    filePath: string,
    line: number,
    column: number,
    displayText: string,
    enabled: boolean
): string {
    if (!enabled) {
        return displayText;
    }
    return fileHyperlink(filePath, line, column, displayText);
}
