# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nexus is a deep storage solution using AWS S3 tiers (Standard → Glacier) for cost-effective file archival. Think "Dropbox for archival" - users upload files they want to keep long-term but don't need instant access to.

**Phase:** MVP Planning & Development (POC complete)
**Stack:** Next.js 16 / Supabase (DB) / AWS S3 / Stripe / Vercel
**Auth:** BetterAuth | **ORM:** Drizzle | **API:** tRPC v11
**Monorepo:** pnpm workspaces + Turborepo | **IaC:** Terraform
**Styling:** Tailwind | **Storage:** Glacier-first | **Testing:** Vitest + Playwright

## Commands

All commands run from monorepo root:

```bash
pnpm dev          # Start dev server (Turbopack)
pnpm build        # Build all workspaces
pnpm lint         # Run ESLint
pnpm test         # Run tests
pnpm check        # Run lint + build + test (via Turborepo)
pnpm typecheck    # TypeScript check
pnpm env:pull     # Pull env vars from Vercel
```

Workspace-specific commands use `-F` filter:

```bash
pnpm -F web add <package>      # Add dependency to web app
pnpm -F web add -D <package>   # Add dev dependency
```

**REQUIRED - Before committing any changes:** You MUST run `pnpm check` to verify lint, build, and tests pass across all packages. This catches type errors, lint violations, and test failures before they reach CI.

**REQUIRED - After modifying pages or components:** You MUST also run `pnpm -F web test:e2e:smoke` to catch render errors. Smoke tests run post-merge in CI, so local verification is critical.

## Environment Setup

Env vars managed via Vercel, pulled locally:

```bash
vercel link       # One-time setup
pnpm env:pull     # Creates apps/web/.env.local
```

Type-safe access via `@/lib/env`:

```typescript
import { env } from '@/lib/env';
const bucket = env.S3_BUCKET; // Validated at runtime
```

## Dev Logs

In development, server logs are written to `apps/web/.dev.log` in NDJSON format. The file is truncated on each dev server start.

**Commands for AI agents:**

```bash
tail -50 apps/web/.dev.log | jq .         # Recent logs, formatted
tail -f apps/web/.dev.log                  # Follow live
grep '"level":50' apps/web/.dev.log | jq . # Find errors
grep '"source":"client"' apps/web/.dev.log | jq . # Client logs only
```

**Log format fields:**

- `level`: 10=trace, 20=debug, 30=info, 40=warn, 50=error
- `time`: Unix timestamp (ms)
- `msg`: Log message
- `source`: "client" for browser logs
- Request logs: `requestId`, `path`, `type`, `durationMs`, `userId`

**When to check logs:**

- After code changes to verify behavior
- Debugging tRPC failures
- Viewing client-side errors
- Tracing request timing

## Database (Drizzle)

Schema, repositories, and migrations live in `packages/db/` (`@nexus/db`).

Commands run from monorepo root using `-F db` filter:

```bash
pnpm -F db db:generate         # Generate migration from schema changes
pnpm -F db db:migrate          # Apply pending migrations
pnpm -F db db:studio           # Open Drizzle Studio
pnpm -F db db:custom <name>    # Generate empty migration for RLS/functions
```

**Workflow:**

- Schema changes → edit `packages/db/src/schema/` → `db:generate` → `db:migrate`
- RLS/functions → `db:custom <name>` → edit SQL file → `db:migrate`

**Rules:**

- Always use drizzle-kit commands (never manually create migration files)
- Never edit `packages/db/src/migrations/meta/` journal
- Flag destructive changes (dropping columns/tables) before running

## Repository Structure

```
nexus/
├── apps/
│   ├── web/               # Next.js application (Vercel)
│   │   ├── server/        # tRPC routers, services
│   │   └── lib/           # Shared utilities (env, jobs, storage)
│   └── worker/            # Lambda SQS worker (AWS)
├── packages/
│   ├── db/                # Shared Drizzle schema, repos, types
│   └── trpc-devtools/     # tRPC developer tools (npm package)
├── infra/terraform/       # AWS infrastructure (S3, SQS, Lambda, IAM)
└── docs/                  # Obsidian documentation vault
```

## Documentation

The `docs/` folder is an Obsidian vault with all project documentation:

```
docs/
├── ai/                  # AI context - start here
│   ├── context.md       # Project background & data model
│   ├── conventions.md   # Naming, structure, code style
│   └── github-workflow.md # Issue creation & relationships
├── architecture/        # System design
├── guides/              # Implementation patterns
└── planning/            # Roadmap & MVP scope
```

### Required Reading

| When                             | You MUST read                                               |
| -------------------------------- | ----------------------------------------------------------- |
| Before writing any code          | `docs/ai/conventions.md` - naming, structure, code style    |
| When unfamiliar with the project | `docs/ai/context.md` - data model, architecture, tech stack |

## Git Commits

- Keep commit messages concise and conventional

## Task Workflow

All non-trivial work should have a GitHub Issue before starting.

### Before Starting Work

1. Ask which issue this relates to, or list open issues
2. If no issue exists, propose creating one (get user approval first)
3. Read the issue to understand scope and acceptance criteria

### Creating Issues

**Before creating any GitHub issue, you MUST read `docs/ai/github-workflow.md`.**

### Referencing Issues

- In commits: `feat: add login form (#42)`
- In PRs: `Closes #42` in the PR body
- For trivial changes (typos, deps, CI config): use `No-Issue: <reason>` in the PR body
