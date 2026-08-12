/**
 * Auth values that have to agree across the BetterAuth config, the emails, the
 * UI copy, and tests. Deliberately free of server imports so client components
 * can read the same numbers the server enforces.
 */

/**
 * Lifetime of a password-reset token. Drives BetterAuth's
 * `resetPasswordTokenExpiresIn`, the expiry printed in the reset email, and the
 * copy on the reset pages, so none of them can drift apart.
 */
export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 60 * 60;

/** The TTL above in the words the UI uses for it. */
export const RESET_PASSWORD_TOKEN_TTL_LABEL = 'an hour';

/** BetterAuth's server-side minimum for credential passwords. */
export const MIN_PASSWORD_LENGTH = 8;
