/**
 * Prints the database a command is about to run against, then exits.
 *
 * Chained ahead of `drizzle-kit migrate`, which resolves DATABASE_URL through
 * `drizzle.config.ts` and never calls `requireDatabaseUrl`, so it would
 * otherwise apply migrations to whatever the env happens to point at without
 * saying which database that is. Inside a worktree that is the shared dev
 * database, not the worktree's own — the failure mode this exists to surface.
 *
 * Banner only: it opens no connection and changes nothing, so chaining it
 * cannot break the command that follows.
 */
import { requireDatabaseUrl } from './env';

requireDatabaseUrl();
