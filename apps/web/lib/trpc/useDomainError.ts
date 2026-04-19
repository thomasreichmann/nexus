import type { TRPCClientErrorLike } from '@trpc/client';

import type { DomainErrorCode } from '@/server/errors';
import type { AppRouter } from '@/server/trpc/router';

export interface DomainErrorInfo {
    code: DomainErrorCode;
    message: string;
}

/**
 * Returns `{ code, message }` when the tRPC error is a `DomainError`, otherwise
 * `null`. Use the returned `code` to branch exhaustively on `DomainErrorCode`.
 */
export function useDomainError(
    error: TRPCClientErrorLike<AppRouter> | null | undefined
): DomainErrorInfo | null {
    const domainCode = error?.data?.domainCode;
    if (!domainCode) {
        return null;
    }
    return { code: domainCode, message: error.message };
}
