# CLAUDE.md - web

App-specific instructions for working on `apps/web/`.

## Required Reading

| When                         | You MUST read                            |
| ---------------------------- | ---------------------------------------- |
| Before working on storage/S3 | `docs/guides/storage.md` - S3 module API |

## E2E Tests

These run against a production build (`next build` + `next start`) on an
ephemeral port, so they build before running and coexist with `pnpm dev`.

Pick the smallest tier that covers your change:

| Command                            | Covers                             | Run when you changed                              |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------- |
| `pnpm -F web test:e2e:smoke`       | page renders + light flows         | any page/component (REQUIRED)                     |
| `pnpm -F web test:e2e:flows`       | file browser + upload interactions | files/upload UI or their routers                  |
| `pnpm -F web test:e2e:admin`       | admin jobs/files/dev-tools         | admin features                                    |
| `pnpm -F web test:e2e`             | all of the above                   | cross-cutting changes (auth, tRPC client, layout) |
| `pnpm -F web e2e:coverage --check` | coverage gate (no browsers)        | added a page, use-case, or test                   |

Do NOT run `test:e2e:validate` unless explicitly asked — it's destructive
(real S3 objects, mutates the dev user's quota).

`test:e2e:repro` is the bug-repro tier (`e2e/repro/`, env-gated behind
`E2E_REPRO`): specs there are born red on live bugs and never run in
`test:e2e` or CI. See "Reproducing a bug with data" below.

**Test data is back-door, typed.** Import `{ test, expect }` from `e2e/fixtures`
and seed preconditions through `@nexus/db/test-db` (factories + insert/query/
scenario helpers) or the precondition fixtures — never hand-written SQL or a raw
`postgres` driver. Only the behavior under test goes through the UI. See
`docs/conventions/testing.md` for the factory/fixture/scenario layers.

**Output is compact by design** (`e2e/reporters/compact.ts`): one summary
line on success; on failure, the trimmed error plus a `context:` path.
Read that file first — it's a page snapshot at the moment of failure and
usually explains the error without re-running anything. Flaky tests are
named even on green runs; treat them as bugs, not noise.

Escape hatches: `--reporter=list` (full per-test output),
`npx playwright show-report` (traces). Run a single spec/test with
`npx playwright test <file> -g "<title>"`.

## Reproducing a bug with data

Write bug reproductions as specs in `e2e/repro/`, not as scratch scripts — a
spec inherits auth, db, and seeding from `e2e/fixtures` and becomes the
regression guard when the fix lands. The tier is env-gated
(`pnpm -F web test:e2e:repro`), so a spec that is red while the bug lives
never breaks `test:e2e` on main.

- **Start from the exemplar:** `e2e/repro/311-mobile-overflow.spec.ts` —
  dedicated user, worker-scoped seed, mobile viewport + dark mode via
  `test.use` (plain chromium viewport override; CI installs chromium only).
- **Seed before you measure.** Empty accounts hide data-dependent bugs (an
  empty dashboard renders perfectly while a real one breaks). Seed a
  hostile-but-realistic library with `seedAdversarialLibrary(db, userId)`
  from `@nexus/db/test-db`: long unbreakable filenames, unicode, ~40 rows,
  edge-case sizes, every tier/status.
- **Layout blowouts:** assert with `expectNoHorizontalOverflow(page)` from
  `e2e/helpers/overflow`. Never assert on `document.scrollWidth` — the
  dashboard shell's `overflow-hidden` pins it to the viewport, so it reads
  zero overflow on a genuinely broken page (the #311 false negative).
- **DB forensics:** `pnpm -F db db:query "<sql>"` — read-only raw SQL
  against the current env's DB, JSON out. No hand-rolled `db.execute` loops.
- **Real S3 state:** `createTestS3()` / `moveToTier()` / `getStorageClass()`
  from `e2e/helpers/s3` — client from env plus the tier-move self-copy.
- **Lifecycle:** born red in `e2e/repro/` with NO `@page`/`@uc` tags. When
  the fix flips it green, either graduate it (add tags, move into a running
  tier, keep a dedicated user — never seed the shared smoke user) or delete
  it. There is no archive; git history and session transcripts are the
  museum.

### Scratch scripts (only when a spec truly can't do it)

- Run from inside a workspace package (`apps/web`, `packages/db`) so
  `@nexus/db` / `@playwright/test` resolve. Never from `/tmp` or a
  scratchpad dir — `ERR_MODULE_NOT_FOUND` is the #1 recurring trap.
- Import `@playwright/test`, never `playwright` (not installed).
- Wrap everything in `async function main()` + `main().catch(...)` —
  `apps/web` transpiles to CJS, so top-level await fails.
- No named inner functions inside `page.evaluate` callbacks — tsx/esbuild
  injects a `__name` helper the page context doesn't have. Arrow functions
  only. (Specs run under `playwright test` don't have this problem — its
  transform is different, which is one more reason to prefer a spec.)
- Driving a dev server: target this worktree's `$PORT` and poll readiness
  before driving. Never assume `:3000` — that's another worktree's server;
  a wrong-server screenshot and a collateral `pkill` have both happened.

**Never pass `--` before extra args to a pnpm test script.** pnpm forwards the
`--` literally, and Playwright then silently mis-selects and runs the full
suite: `pnpm -F web test:e2e:smoke -- subscription.spec.ts` runs all tests.
Append args directly (`pnpm -F web test:e2e:smoke subscription.spec.ts`) or
run the binary via `pnpm -F web exec playwright test <file>`.
