import { unwrapSuperJSON, detectSuperJSON } from './superjson';

export interface TRPCRequest {
    path: string;
    type: 'query' | 'mutation';
    input?: unknown;
}

export interface TRPCResponse {
    ok: boolean;
    data?: unknown;
    error?: {
        message: string;
        code?: string;
        data?: unknown;
    };
    rawResponse: unknown;
    usedSuperJSON: boolean;
    timing: {
        startedAt: number;
        completedAt: number;
        durationMs: number;
    };
}

export interface RequestOptions {
    trpcUrl: string;
    headers?: Record<string, string>;
    /**
     * If true, wrap input in SuperJSON format { json: input }
     * Required when the tRPC server uses superjson transformer
     */
    useSuperJSON?: boolean;
}

/**
 * Execute a tRPC request directly from the browser
 */
export async function executeRequest(
    request: TRPCRequest,
    options: RequestOptions
): Promise<TRPCResponse> {
    const startedAt = Date.now();

    try {
        const url = new URL(options.trpcUrl, window.location.origin);

        // tRPC uses the procedure path as the URL path
        url.pathname = `${url.pathname}/${request.path}`;

        let response: Response;

        if (request.type === 'query') {
            // Queries use GET with input as query param
            // Wrap in SuperJSON format if the server uses superjson transformer
            if (request.input !== undefined) {
                const queryInput = options.useSuperJSON
                    ? { json: request.input }
                    : request.input;
                url.searchParams.set('input', JSON.stringify(queryInput));
            }

            response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                credentials: 'include',
            });
        } else {
            // Mutations use POST with input in body
            // Wrap in SuperJSON format if the server uses superjson transformer
            const bodyInput = options.useSuperJSON
                ? { json: request.input ?? {} }
                : (request.input ?? {});

            response = await fetch(url.toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                credentials: 'include',
                body: JSON.stringify(bodyInput),
            });
        }

        const completedAt = Date.now();
        const rawResponse = await response.json();

        // tRPC wraps responses in { result: { data: ... } } or { error: ... }
        const usedSuperJSON = detectSuperJSON(rawResponse?.result?.data);

        if (rawResponse.error) {
            // tRPC v11 may wrap error in json property
            const errorData = rawResponse.error.json ?? rawResponse.error;

            // Extract message - could be at different paths depending on tRPC version/adapter
            const message =
                errorData.message ||
                rawResponse.error.message ||
                'Unknown error';

            // Extract code and data
            const code = errorData.data?.code ?? errorData.code;
            const data = errorData.data;

            return {
                ok: false,
                error: {
                    message,
                    code,
                    data,
                },
                rawResponse,
                usedSuperJSON,
                timing: {
                    startedAt,
                    completedAt,
                    durationMs: completedAt - startedAt,
                },
            };
        }

        // Unwrap SuperJSON if detected
        const data = usedSuperJSON
            ? unwrapSuperJSON(rawResponse?.result?.data)
            : rawResponse?.result?.data;

        return {
            ok: true,
            data,
            rawResponse,
            usedSuperJSON,
            timing: {
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
            },
        };
    } catch (err) {
        const completedAt = Date.now();

        return {
            ok: false,
            error: {
                message: err instanceof Error ? err.message : 'Request failed',
            },
            rawResponse: null,
            usedSuperJSON: false,
            timing: {
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
            },
        };
    }
}
