import type { TRPCDefaultErrorShape, TRPCError } from '@trpc/server';

import type { DomainErrorCode } from '@/lib/errors/codes';
import { isDomainError } from '@/server/errors';

import { isUnexpectedTrpcError } from './error-classification';

export type DomainErrorShape = TRPCDefaultErrorShape & {
    data: TRPCDefaultErrorShape['data'] & {
        domainCode: DomainErrorCode | undefined;
        expected: boolean;
    };
};

/**
 * Surfaces `DomainError.code` on the client-visible error shape so the
 * frontend can discriminate errors sharing a tRPC code (e.g. FORBIDDEN vs
 * TRIAL_EXPIRED). Non-DomainError causes (bare TRPCError, ZodError, etc.)
 * produce `domainCode: undefined`.
 *
 * Also serializes the expected-vs-defect verdict (`expected`) — the single
 * source the client-side Sentry filter (lib/trpc/error-reporting.ts) reads,
 * instead of re-deriving the classification from the shape.
 */
export function domainErrorFormatter({
    shape,
    error,
}: {
    shape: TRPCDefaultErrorShape;
    error: TRPCError;
}): DomainErrorShape {
    const domainCode: DomainErrorCode | undefined = isDomainError(error.cause)
        ? error.cause.code
        : undefined;

    return {
        ...shape,
        data: {
            ...shape.data,
            domainCode,
            expected: !isUnexpectedTrpcError(error),
        },
    };
}
