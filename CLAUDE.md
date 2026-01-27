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
pnpm typecheck    # TypeScript check
pnpm env:pull     # Pull env vars from Vercel
```

Workspace-specific commands use `-F` filter:

```bash
pnpm -F web add <package>      # Add dependency to web app
pnpm -F web add -D <package>   # Add dev dependency
```

**REQUIRED - After modifying pages or components:** You MUST run `pnpm -F web test:e2e:smoke` to catch render errors before committing. Smoke tests run post-merge in CI, so local verification is critical.

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

## Database (Drizzle)

Commands run from `apps/web/` or use `-F web` filter:

```bash
pnpm -F web db:generate         # Generate migration from schema changes
pnpm -F web db:migrate          # Apply pending migrations
pnpm -F web db:studio           # Open Drizzle Studio
pnpm -F web db:custom <name>    # Generate empty migration for RLS/functions
```

**Workflow:**

- Schema changes → edit `server/db/schema.ts` → `db:generate` → `db:migrate`
- RLS/functions → `db:custom <name>` → edit SQL file → `db:migrate`

**Rules:**

- Always use drizzle-kit commands (never manually create migration files)
- Never edit `server/db/migrations/meta/` journal
- Flag destructive changes (dropping columns/tables) before running

## Repository Structure

```
nexus/
├── apps/web/              # Next.js application
│   ├── server/db/         # Drizzle schema & migrations
│   └── lib/env/           # Type-safe env validation
├── infra/terraform/       # AWS infrastructure (S3, IAM)
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
| Before working on storage/S3     | `docs/guides/storage.md` - S3 module API                    |
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
- For trivial changes (typos, deps, CI config): use `No-Issue: <reason>` instead
