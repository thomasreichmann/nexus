import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

import { DOMAIN_ERROR_CODES, type DomainErrorCode } from '@/lib/errors/codes';

/**
 * Base class for all domain errors. Services throw these, middleware maps to
 * TRPCError. Each subclass declares a `static readonly code` from the registry
 * and mirrors it onto the instance, so class-level (`NotFoundError.code`) and
 * instance-level (`error.code`) reads both work without drift. The `abstract
 * readonly code` here is what forces every subclass to wire that up.
 */
export abstract class DomainError extends Error {
    abstract readonly code: DomainErrorCode;

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
    static readonly code = DOMAIN_ERROR_CODES.NOT_FOUND;
    readonly code = NotFoundError.code;
    constructor(entity: string, id?: string) {
        super(
            id ? `${entity} not found: ${id}` : `${entity} not found`,
            'NOT_FOUND'
        );
    }
}

/** User doesn't have permission. */
export class ForbiddenError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.FORBIDDEN;
    readonly code = ForbiddenError.code;
    constructor(message = 'You do not have permission to perform this action') {
        super(message, 'FORBIDDEN');
    }
}

/** Operation not allowed in current state. */
export class InvalidStateError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.INVALID_STATE;
    readonly code = InvalidStateError.code;
    constructor(message: string) {
        super(message, 'BAD_REQUEST');
    }
}

/** Quota or limit exceeded. */
export class QuotaExceededError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.QUOTA_EXCEEDED;
    readonly code = QuotaExceededError.code;
    constructor(message = 'Quota exceeded') {
        super(message, 'PRECONDITION_FAILED');
    }
}

/** User's trial has expired. Distinct from generic FORBIDDEN so the UI can show a dedicated banner. */
export class TrialExpiredError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.TRIAL_EXPIRED;
    readonly code = TrialExpiredError.code;
    constructor(message = 'Trial has expired') {
        super(message, 'FORBIDDEN');
    }
}

/** Type guard to check for DomainError (handles cross-module instanceof issues). */
export function isDomainError(error: unknown): error is DomainError {
    return (
        error instanceof Error &&
        'trpcCode' in error &&
        typeof (error as DomainError).trpcCode === 'string' &&
        'code' in error &&
        typeof (error as DomainError).code === 'string'
    );
}
