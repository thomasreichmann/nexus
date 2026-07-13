import { TRPCClientError } from '@trpc/client';

import type { DomainErrorCode } from '@/lib/errors/codes';
import type { AppRouter } from '@/server/trpc/router';

type ClientError = TRPCClientError<AppRouter>;
type ErrorShape = NonNullable<ClientError['shape']>;

/**
 * Build a synthetic `TRPCClientError` with the given tRPC code / domainCode —
 * matching the shape produced by `domainErrorFormatter` on the server.
 * Use this in tests to exercise client-side error pipelines without spinning
 * up a full tRPC caller.
 */
export function makeClientError(opts: {
    code: string;
    domainCode?: DomainErrorCode;
    message?: string;
    httpStatus?: number;
    // The server's expected-vs-defect verdict (error-formatter.ts). Domain
    // errors are always expected, so it defaults on when domainCode is set.
    expected?: boolean;
}): ClientError {
    const message = opts.message ?? 'test';
    // JSON-RPC outer `code` is arbitrary for client-side tests — consumers
    // read `data.code` / `data.domainCode`, not the jsonrpc envelope.
    return new TRPCClientError<AppRouter>(message, {
        result: {
            error: {
                code: -32600,
                message,
                data: {
                    code: opts.code,
                    httpStatus: opts.httpStatus ?? 403,
                    path: 'test',
                    domainCode: opts.domainCode,
                    expected: opts.expected ?? opts.domainCode !== undefined,
                } as ErrorShape['data'],
            } as ErrorShape,
        },
    });
}
