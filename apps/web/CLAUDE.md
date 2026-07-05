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

**Never pass `--` before extra args to a pnpm test script.** pnpm forwards the
`--` literally, and Playwright then silently mis-selects and runs the full
suite: `pnpm -F web test:e2e:smoke -- subscription.spec.ts` runs all tests.
Append args directly (`pnpm -F web test:e2e:smoke subscription.spec.ts`) or
run the binary via `pnpm -F web exec playwright test <file>`.
