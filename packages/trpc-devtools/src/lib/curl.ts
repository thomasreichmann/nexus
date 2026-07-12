import type { TRPCRequest } from './request';

export interface CurlOptions {
    /** tRPC endpoint URL (may be relative) */
    trpcUrl: string;
    /** Origin used to resolve a relative trpcUrl (window.location.origin) */
    origin: string;
    /** Custom headers from the auth config */
    headers?: Record<string, string>;
    /** Wrap the input in SuperJSON format { json: input } */
    useSuperJSON?: boolean;
    /** Cookie header value to include via -b (document.cookie) */
    cookieHeader?: string;
}

/**
 * Quote a string for safe use in a POSIX shell. Wraps in single quotes and
 * escapes embedded single quotes via the '\'' idiom.
 */
export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a cURL command mirroring how executeRequest() issues the call:
 * GET with an `input` query param for queries, POST with a JSON body for
 * mutations, SuperJSON-wrapped when the server uses that transformer.
 */
export function buildCurlCommand(
    request: TRPCRequest,
    options: CurlOptions
): string {
    const url = new URL(options.trpcUrl, options.origin);
    url.pathname = `${url.pathname}/${request.path}`;

    const parts: string[] = [];

    if (request.type === 'query') {
        if (request.input !== undefined) {
            const queryInput = options.useSuperJSON
                ? { json: request.input }
                : request.input;
            url.searchParams.set('input', JSON.stringify(queryInput));
        }
        parts.push(`curl ${shellQuote(url.toString())}`);
    } else {
        const body = options.useSuperJSON
            ? { json: request.input ?? {} }
            : (request.input ?? {});
        parts.push(`curl -X POST ${shellQuote(url.toString())}`);
        parts.push(`-H ${shellQuote('Content-Type: application/json')}`);
        parts.push(`--data ${shellQuote(JSON.stringify(body))}`);
    }

    for (const [name, value] of Object.entries(options.headers ?? {})) {
        parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
    }

    if (options.cookieHeader) {
        parts.push(`-b ${shellQuote(options.cookieHeader)}`);
    }

    return parts.join(' \\\n  ');
}
