/**
 * `@nexus/db/test-db` — typed, connection-injectable test data helpers.
 *
 * The home for code that BOTH unit integration tests and Playwright e2e load:
 * - Factories (re-exported from repositories/fixtures) — pure row builders,
 *   shared with unit tests, the single source of column defaults.
 * - Inserts — build a row from a factory and write it (id/uniqueness minted here).
 * - Queries — find/update/delete/upsert/count against a real connection.
 * - Scenarios — multi-step states (ready retrieval, paid subscription).
 *
 * Deliberately vitest-free: it never re-exports `../testing` (which pulls
 * `vitest` via `repositories/mocks`), so importing it from the Playwright
 * runtime is safe. The `postgres` driver only loads when a caller builds a
 * connection via `createDb()`.
 */
export * from './inserts';
export * from './queries';
export * from './scenarios';
export { createDb, type DB, type Connection } from '../connection';
export * from '../repositories/fixtures';

// Entity row types, so callers can type seeded entities without reaching into
// the repo subpaths.
export type { File, NewFile } from '../repositories/files';
export type { UploadBatch } from '../repositories/uploadBatches';
export type { Retrieval } from '../repositories/retrievals';
export type { Subscription } from '../repositories/subscriptions';
export type { Job, NewJob } from '../repositories/jobs';
