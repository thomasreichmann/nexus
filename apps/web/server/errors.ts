import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

/**
 * Registry of all domain error codes. Each code maps 1:1 to a DomainError subclass.
 * Frontend imports `DomainErrorCode` to exhaustively branch on server-side errors.
 */
export const DOMAIN_ERROR_CODES = {
    NOT_FOUND: 'NOT_FOUND',
    INVALID_STATE: 'INVALID_STATE',
    FORBIDDEN: 'FORBIDDEN',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    TRIAL_EXPIRED: 'TRIAL_EXPIRED',
} as const;

export type DomainErrorCode =
    (typeof DOMAIN_ERROR_CODES)[keyof typeof DOMAIN_ERROR_CODES];

/**
 * Base class for all domain errors. Services throw these, middleware maps to
 * TRPCError. Each subclass declares a `static readonly code` from the registry;
 * the instance `code` getter reads it so the wire format stays a single source
 * of truth.
 */
export abstract class DomainError extends Error {
    constructor(
        message: string,
        public readonly trpcCode: TRPC_ERROR_CODE_KEY
    ) {
        super(message);
        this.name = this.constructor.name;
    }

    get code(): DomainErrorCode {
        return (this.constructor as unknown as { code: DomainErrorCode }).code;
    }
}

/** Resource not found. */
export class NotFoundError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.NOT_FOUND;
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
    constructor(message = 'You do not have permission to perform this action') {
        super(message, 'FORBIDDEN');
    }
}

/** Operation not allowed in current state. */
export class InvalidStateError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.INVALID_STATE;
    constructor(message: string) {
        super(message, 'BAD_REQUEST');
    }
}

/** Quota or limit exceeded. */
export class QuotaExceededError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.QUOTA_EXCEEDED;
    constructor(message = 'Quota exceeded') {
        super(message, 'PRECONDITION_FAILED');
    }
}

/** User's trial has expired. Distinct from generic FORBIDDEN so the UI can show a dedicated banner. */
export class TrialExpiredError extends DomainError {
    static readonly code = DOMAIN_ERROR_CODES.TRIAL_EXPIRED;
    constructor(message = 'Your trial has expired') {
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
