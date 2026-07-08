# CLAUDE.md

## Project Overview

Nexus is a deep storage solution using AWS S3 tiers (Standard → Glacier) for cost-effective file archival. "Dropbox for archival."

**Stack:** Next.js 16 / Supabase (DB) / AWS S3 / Stripe / Vercel
**Auth:** BetterAuth | **ORM:** Drizzle | **API:** tRPC v11
**Monorepo:** pnpm workspaces + Turborepo | **IaC:** Terraform
**Styling:** Tailwind | **Testing:** Vitest + Playwright

## Commands

**REQUIRED before committing:** `pnpm check` (runs lint + build + test via Turborepo).
**REQUIRED after modifying pages/components:** `pnpm -F web test:e2e:smoke`.
**REQUIRED after adding a page, use-case, or e2e test:** `pnpm -F web e2e:coverage --check`.
Full E2E tier table and test-selection gotchas: `apps/web/CLAUDE.md`.

## Database (Drizzle)

Schema in `packages/db/` (`@nexus/db`). Env vars: `import { env } from '@/lib/env'`.

```bash
pnpm -F db db:generate         # Generate migration from schema changes
pnpm -F db db:migrate          # Apply pending migrations
pnpm -F db db:studio           # Open Drizzle Studio
pnpm -F db db:custom <name>    # Empty migration for RLS/functions
pnpm -F db db:query "<sql>"    # Read-only raw SQL against the current env's DB (forensics)
```

## Stripe

Stripe CLI is installed and authenticated to the sandbox (test-mode only; live mode pending).

## Bug Repro

Reproduce bugs as specs in `apps/web/e2e/repro/`, not scratch scripts — specs
inherit auth/db/seeding from `e2e/fixtures` and become the regression guard.
The tier (`pnpm -F web test:e2e:repro`, env-gated behind `E2E_REPRO`) never
runs in `test:e2e` or CI, so red specs are safe. Exemplar:
`311-mobile-overflow.spec.ts`.

- Seed before measuring — empty accounts hide data bugs:
  `seedAdversarialLibrary(db, userId)` from `@nexus/db/test-db`.
- Layout blowouts: `expectNoHorizontalOverflow(page)` from
  `e2e/helpers/overflow`, never `document.scrollWidth` (the dashboard shell's
  `overflow-hidden` makes it read zero on a broken page).
- Real S3 state: `createTestS3()` / `moveToTier()` / `getStorageClass()` from
  `e2e/helpers/s3`.
- Red specs carry no `@page`/`@uc` tags. Once green: graduate (tags, running
  tier, dedicated user) or delete.
- Scratch scripts (last resort): run from inside a workspace package, never
  `/tmp`; import `@playwright/test`, not `playwright`; wrap in
  `main().catch(...)` (CJS — no top-level await); arrow functions only inside
  `page.evaluate`; target this worktree's `$PORT`, never `:3000`.

## Required Reading

- **Before writing code:** `docs/ai/conventions.md` — naming, structure, style
- **When unfamiliar with project:** `docs/ai/context.md` — data model, architecture
- **When writing UI features:** `docs/guides/e2e-testing-guidelines.md` — E2E decisions
- **Before creating GitHub issues:** `docs/ai/github-workflow.md` — issue format & labels
- **To refresh the README demo GIF/MP4:** `docs/ai/recording-captures.md` — `pnpm capture` (the `tooling/capture` scene recorder)

## Git & Workflow

- Conventional commit messages: `feat: add login form (#42)`
- All non-trivial work should have a GitHub Issue before starting
- PRs reference issues: `Closes #42` or `No-Issue: <reason>` for trivial changes
