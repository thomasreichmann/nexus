// Regex-based TypeScript syntax highlighting for terminal output.
// Pure functions - no shiki dependency for simpler maintenance.

export interface ColorFunctions {
    dim: (s: string) => string;
    gray: (s: string) => string;
    cyan: (s: string) => string;
    yellow: (s: string) => string;
    bold: (s: string) => string;
}

export function createColorFunctions(enabled: boolean): ColorFunctions {
    if (!enabled) {
        const identity = (s: string) => s;
        return {
            dim: identity,
            gray: identity,
            cyan: identity,
            yellow: identity,
            bold: identity,
        };
    }

    return {
        dim: (s) => `\x1b[2m${s}\x1b[0m`,
        gray: (s) => `\x1b[90m${s}\x1b[0m`,
        cyan: (s) => `\x1b[36m${s}\x1b[0m`,
        yellow: (s) => `\x1b[33m${s}\x1b[0m`,
        bold: (s) => `\x1b[1m${s}\x1b[0m`,
    };
}

const PATTERNS = {
    // Keywords that affect control flow
    keyword:
        /\b(await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|import|in|instanceof|interface|let|new|null|of|return|super|switch|this|throw|true|try|typeof|var|void|while|with|yield)\b/g,
    // TypeScript-specific keywords
    typeKeyword:
        /\b(abstract|as|asserts|declare|implements|keyof|namespace|never|private|protected|public|readonly|satisfies|static|type|unknown)\b/g,
    // Numbers (hex, binary, octal, decimal, scientific)
    number: /\b(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/g,
    // String literals
    string: /(['"`])(?:\\.|(?!\1).)*\1/g,
    // Comments
    comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    // Object property access
    property: /(?<=\.)[a-zA-Z_]\w*/g,
    // Function calls
    functionCall: /\b([A-Za-z_]\w*)\s*(?=\()/g,
};

export function highlightLine(line: string, colors: ColorFunctions): string {
    // Use placeholder markers to prevent double-highlighting
    const START = '\u0000';
    const END = '\u0001';

    let result = line;

    const wrap = (regex: RegExp, colorFn: (s: string) => string) => {
        result = result.replace(
            regex,
            (match) => `${START}${colorFn(match)}${END}`
        );
    };

    // Order matters - comments and strings first to prevent keyword highlighting inside them
    wrap(PATTERNS.comment, colors.gray);
    wrap(PATTERNS.string, colors.cyan);
    wrap(PATTERNS.number, colors.yellow);
    wrap(PATTERNS.keyword, colors.bold);
    wrap(PATTERNS.typeKeyword, colors.dim);
    wrap(PATTERNS.property, colors.dim);
    wrap(PATTERNS.functionCall, colors.bold);

    // Remove placeholder markers
    return result.replace(/\u0000|\u0001/g, '');
}
