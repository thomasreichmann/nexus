/**
 * Narrows an unknown thrown value to a message string. Anything can be thrown,
 * but the places that record failures — webhook `error` columns, alert context,
 * retrieval `errorMessage` — all need a plain string.
 */
export function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Postgres SQLSTATE for a unique-constraint violation. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Postgres SQLSTATE class 08 — connection exception, in all its variants. */
const POSTGRES_CONNECTION_EXCEPTION_CLASS = '08';

/**
 * Failures where the request was fine and the infrastructure under it was not,
 * so retrying the identical request has a real chance of succeeding.
 *
 * Deliberately an allowlist: an unrecognised error counts as a business error,
 * because a bug in our own code retried forever is worse than one recorded and
 * investigated (#331).
 */
const TRANSIENT_ERROR_CODES = new Set([
    // Node socket failures. Also how a `fetch` to S3 or Stripe surfaces —
    // `TypeError: fetch failed` carries the real code on its `cause`.
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    // postgres.js connection lifecycle.
    'CONNECTION_CLOSED',
    'CONNECTION_ENDED',
    'CONNECTION_DESTROYED',
    'CONNECT_TIMEOUT',
    // Postgres server states that clear on their own: pool exhausted, server
    // shutting down, and the two concurrency collisions a retry resolves.
    '53300',
    '57P01',
    '40001',
    '40P01',
]);

/** Guards against a self-referential `cause` chain. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Every `code` along the thrown value's `cause` chain. Wrappers are common —
 * undici reports a refused connection as `TypeError: fetch failed` with the
 * `ECONNREFUSED` one level down — so the outermost error rarely carries it.
 */
function getErrorCodes(err: unknown): string[] {
    const codes: string[] = [];
    let current = err;

    for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
        if (typeof current !== 'object' || current === null) break;

        const { code, cause } = current as { code?: unknown; cause?: unknown };
        if (typeof code === 'string') codes.push(code);
        current = cause;
    }

    return codes;
}

/**
 * A concurrent insert of the same webhook event lost the race. Both webhook
 * routes treat this as a duplicate delivery, not a failure.
 */
export function isUniqueViolation(err: unknown): boolean {
    return getErrorCodes(err).includes(POSTGRES_UNIQUE_VIOLATION);
}

/**
 * Whether a retry of the identical request would plausibly succeed.
 *
 * Webhook routes rethrow these instead of recording a `failed` row: the 5xx
 * makes the provider retry, which is the only thing that recovers a delivery,
 * since nothing re-drives a stored row on its own. They also skip the row
 * update and the alert on that path — if the database is what broke, both
 * would throw too, and a row left at `received` is what the nightly sweep in
 * `check-s3-event-health` looks for when the retries never land (#331).
 */
export function isTransientInfraError(err: unknown): boolean {
    return getErrorCodes(err).some(
        (code) =>
            TRANSIENT_ERROR_CODES.has(code) ||
            code.startsWith(POSTGRES_CONNECTION_EXCEPTION_CLASS)
    );
}
