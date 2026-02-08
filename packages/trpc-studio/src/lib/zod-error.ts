/**
 * Zod v4 validation issue as parsed from a tRPC BAD_REQUEST error message.
 *
 * Zod v4 sets `ZodError.message` to `JSON.stringify(issues, null, 2)`,
 * so the error message IS the issues array as a JSON string.
 */
export interface ZodIssue {
    path: (string | number)[];
    message: string;
    code?: string;
    expected?: string;
    received?: string;
}

/**
 * Try to parse a tRPC error as a Zod v4 validation error.
 *
 * Detection strategy: the error message must parse as a JSON array where
 * every item has `path` (array) and `message` (string) fields.
 *
 * Returns the parsed issues array, or `null` if this is not a Zod error.
 */
export function parseZodError(
    error: { message: string; code?: string } | undefined
): ZodIssue[] | null {
    if (!error?.message) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(error.message);
    } catch {
        return null;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Every item must have path (array) and message (string)
    const isZodIssues = parsed.every(
        (item: unknown) =>
            typeof item === 'object' &&
            item !== null &&
            'path' in item &&
            Array.isArray((item as Record<string, unknown>).path) &&
            'message' in item &&
            typeof (item as Record<string, unknown>).message === 'string'
    );

    if (!isZodIssues) return null;

    return parsed.map((item: Record<string, unknown>) => ({
        path: item.path as (string | number)[],
        message: item.message as string,
        code: typeof item.code === 'string' ? item.code : undefined,
        expected: typeof item.expected === 'string' ? item.expected : undefined,
        received: typeof item.received === 'string' ? item.received : undefined,
    }));
}

/**
 * Format a Zod issue path array as a dot-notation string.
 * Example: ["user", "address", 0, "street"] → "user.address[0].street"
 */
export function formatIssuePath(path: (string | number)[]): string {
    if (path.length === 0) return '(root)';

    return path.reduce<string>((acc, segment, i) => {
        if (typeof segment === 'number') {
            return `${acc}[${segment}]`;
        }
        return i === 0 ? segment : `${acc}.${segment}`;
    }, '');
}
