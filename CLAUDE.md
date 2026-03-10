# CLAUDE.md

## Project Overview

Nexus is a deep storage solution using AWS S3 tiers (Standard → Glacier) for cost-effective file archival. "Dropbox for archival."

**Stack:** Next.js 16 / Supabase (DB) / AWS S3 / Stripe / Vercel
**Auth:** BetterAuth | **ORM:** Drizzle | **API:** tRPC v11
**Monorepo:** pnpm workspaces + Turborepo | **IaC:** Terraform
**Styling:** Tailwind | **Testing:** Vitest + Playwright

## Commands

```bash
pnpm dev              # Dev server (Turbopack)
pnpm build            # Build all workspaces
pnpm lint             # ESLint
pnpm test             # Tests
pnpm check            # lint + build + test (Turborepo)
pnpm typecheck        # TypeScript check
pnpm env:pull         # Pull env vars from Vercel
```

**REQUIRED before committing:** Run `pnpm check` to verify lint, build, and tests pass.

**REQUIRED after modifying pages/components:** Run `pnpm -F web test:e2e:smoke` to catch render errors.

## Environment

Env vars managed via Vercel (`vercel link` → `pnpm env:pull` → `apps/web/.env.local`).
Type-safe access: `import { env } from '@/lib/env'`.

## Dev Logs

Server logs: `apps/web/.dev.log` (NDJSON, truncated on dev server start).

```bash
tail -50 apps/web/.dev.log | jq .         # Recent logs
grep '"level":50' apps/web/.dev.log | jq . # Errors only
```

## Database (Drizzle)

Schema and migrations in `packages/db/` (`@nexus/db`).

```bash
pnpm -F db db:generate         # Generate migration from schema changes
pnpm -F db db:migrate          # Apply pending migrations
pnpm -F db db:studio           # Open Drizzle Studio
pnpm -F db db:custom <name>    # Empty migration for RLS/functions
```

- Schema changes → edit `packages/db/src/schema/` → `db:generate` → `db:migrate`
- Never manually create migration files or edit `migrations/meta/` journal
- Flag destructive changes (dropping columns/tables) before running

## Repository Structure

```
nexus/
├── apps/web/              # Next.js (Vercel) — server/ for tRPC, lib/ for utilities
├── apps/worker/           # Lambda SQS worker (AWS)
├── packages/db/           # Shared Drizzle schema, repos, types
├── packages/trpc-devtools/ # tRPC developer tools (npm package)
├── infra/terraform/       # AWS infrastructure
└── docs/                  # Obsidian documentation vault
```

## Required Reading

| When                             | Read                                                    |
| -------------------------------- | ------------------------------------------------------- |
| Before writing any code          | `docs/ai/conventions.md` — naming, structure, style     |
| When unfamiliar with the project | `docs/ai/context.md` — data model, architecture         |
| When writing UI features         | `docs/guides/e2e-testing-guidelines.md` — E2E decisions |
| Before creating GitHub issues    | `docs/ai/github-workflow.md` — issue format & labels    |

## Git & Workflow

- Conventional commit messages: `feat: add login form (#42)`
- All non-trivial work should have a GitHub Issue before starting
- PRs reference issues: `Closes #42` or `No-Issue: <reason>` for trivial changes
