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

## Database (Drizzle)

Schema in `packages/db/` (`@nexus/db`). Env vars: `import { env } from '@/lib/env'`.

```bash
pnpm -F db db:generate         # Generate migration from schema changes
pnpm -F db db:migrate          # Apply pending migrations
pnpm -F db db:studio           # Open Drizzle Studio
pnpm -F db db:custom <name>    # Empty migration for RLS/functions
```

## Required Reading

- **Before writing code:** `docs/ai/conventions.md` — naming, structure, style
- **When unfamiliar with project:** `docs/ai/context.md` — data model, architecture
- **When writing UI features:** `docs/guides/e2e-testing-guidelines.md` — E2E decisions
- **Before creating GitHub issues:** `docs/ai/github-workflow.md` — issue format & labels

## Git & Workflow

- Conventional commit messages: `feat: add login form (#42)`
- All non-trivial work should have a GitHub Issue before starting
- PRs reference issues: `Closes #42` or `No-Issue: <reason>` for trivial changes
