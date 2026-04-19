import { TRPCClientError } from '@trpc/client';

import type { DomainErrorCode } from '@/server/errors';
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
}): ClientError {
    const message = opts.message ?? 'test';
    return new TRPCClientError<AppRouter>(message, {
        result: {
            error: {
                code: -32003,
                message,
                data: {
                    code: opts.code,
                    httpStatus: opts.httpStatus ?? 403,
                    path: 'test',
                    domainCode: opts.domainCode,
                } as ErrorShape['data'],
            } as ErrorShape,
        },
    });
}
