/**
 * Registry of all domain error codes. Each code maps 1:1 to a `DomainError`
 * subclass in `@/server/errors`. The registry itself lives here (not under
 * `/server/`) because both sides of the wire need it: the server throws with
 * these codes, the client discriminates on them.
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
