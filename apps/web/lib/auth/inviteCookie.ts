/**
 * Cookie carrying an invite token from the `/invite/[token]` redemption page
 * (#246) to the signup create-hook in `lib/auth/server.ts`, where a valid
 * pending invite provisions a sponsored subscription instead of a trial.
 * Lives outside `server.ts` so the client-side page can import it without
 * pulling in the server auth instance.
 */
export const INVITE_TOKEN_COOKIE = 'nexus_invite_token';
