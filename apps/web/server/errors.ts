import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

/** Base class for all domain errors. Services throw these, middleware maps to TRPCError. */
export abstract class DomainError extends Error {
    constructor(
        message: string,
        public readonly trpcCode: TRPC_ERROR_CODE_KEY
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

/** Resource not found. */
export class NotFoundError extends DomainError {
    constructor(entity: string, id?: string) {
        super(
            id ? `${entity} not found: ${id}` : `${entity} not found`,
            'NOT_FOUND'
        );
    }
}

/** User doesn't have permission. */
export class ForbiddenError extends DomainError {
    constructor(message = 'You do not have permission to perform this action') {
        super(message, 'FORBIDDEN');
    }
}

/** Operation not allowed in current state. */
export class InvalidStateError extends DomainError {
    constructor(message: string) {
        super(message, 'BAD_REQUEST');
    }
}

/** Quota or limit exceeded. */
export class QuotaExceededError extends DomainError {
    constructor(message = 'Quota exceeded') {
        super(message, 'PRECONDITION_FAILED');
    }
}

/** Type guard to check for DomainError (handles cross-module instanceof issues). */
export function isDomainError(error: unknown): error is DomainError {
    return (
        error instanceof Error &&
        'trpcCode' in error &&
        typeof (error as DomainError).trpcCode === 'string'
    );
}
