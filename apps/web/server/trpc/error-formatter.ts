import type { TRPCDefaultErrorShape, TRPCError } from '@trpc/server';

import { isDomainError, type DomainErrorCode } from '@/server/errors';

export type DomainErrorShape = TRPCDefaultErrorShape & {
    data: TRPCDefaultErrorShape['data'] & {
        domainCode: DomainErrorCode | undefined;
    };
};

/**
 * Surfaces `DomainError.code` on the client-visible error shape so the
 * frontend can discriminate errors sharing a tRPC code (e.g. FORBIDDEN vs
 * TRIAL_EXPIRED). Non-DomainError causes (bare TRPCError, ZodError, etc.)
 * produce `domainCode: undefined`.
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
        },
    };
}
