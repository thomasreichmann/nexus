---
title: Getting Started
created: 2025-12-29
updated: 2026-01-23
status: active
tags:
    - guide
    - setup
    - development
    - environment
aliases:
    - Development Setup
    - Quick Start
    - Development Environment
---

# Getting Started

Development environment setup for contributors to the Nexus project.

## Quick Start

If you have all prerequisites installed and credentials configured:

```bash
git clone <repo-url>
cd nexus
pnpm install
vercel link && pnpm env:pull
pnpm -F web db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to verify it's running.

## Prerequisites

### Required Tooling

| Tool       | Version | Installation                                                 |
| ---------- | ------- | ------------------------------------------------------------ |
| Node.js    | 22+     | [nodejs.org](https://nodejs.org)                             |
| pnpm       | 9+      | `corepack enable && corepack prepare pnpm@latest --activate` |
| Vercel CLI | latest  | `pnpm add -g vercel`                                         |
| Git        | latest  | [git-scm.com](https://git-scm.com)                           |

> [!tip] Node Version
> The repo includes `.nvmrc`. If you use nvm/fnm, run `nvm use` or `fnm use` to switch automatically.

### Required Accounts

You'll need access to the project's cloud services:

- **Vercel** — Environment variables and deployment
- **Supabase** — PostgreSQL database
- **AWS** — S3 for file storage
- **Stripe** — Payment integration (test mode)

If you don't have credentials yet, reach out to a maintainer on GitHub or Discord to get added to the shared project.

## Setup Steps

### 1. Clone the Repository

```bash
git clone <repo-url>
cd nexus
```

### 2. Install Dependencies

```bash
pnpm install
```

This installs all workspace dependencies. The monorepo structure:

```
nexus/
├── apps/web/     # Next.js application (main codebase)
├── packages/     # Shared packages (future)
├── docs/         # Documentation (Obsidian vault)
└── infra/        # Terraform infrastructure
```

### 3. Configure Environment Variables

Environment variables are managed through Vercel:

```bash
# Link to the Vercel project (one-time setup)
vercel link

# Pull environment variables
pnpm env:pull
```

This creates `apps/web/.env.local` with all required variables.

> [!warning] Don't Commit .env.local
> The `.env.local` file contains secrets and is gitignored. Never commit it.

See [[environment-setup|Environment Setup]] for details on each variable and type-safe access.

### 4. Set Up the Database

Apply any pending migrations to the Supabase database:

```bash
pnpm -F web db:migrate
```

> [!note] Cloud-First Database
> We use Supabase's cloud PostgreSQL directly—no local database container needed. Your `DATABASE_URL` points to the shared development database.

See [[database-workflow|Database Workflow]] for schema changes and migration commands.

### 5. Start Development

```bash
pnpm dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Verify Your Setup

After starting the dev server, verify everything works:

1. **Home page loads** — Visit `http://localhost:3000`
2. **Auth pages render** — Visit `/sign-in` and `/sign-up`
3. **No console errors** — Check browser dev tools

Run smoke tests to catch render issues:

```bash
pnpm -F web test:e2e:smoke
```

## Common Issues

### "Cannot find module" after clone

Dependencies may be out of sync. Run:

```bash
pnpm install
```

### Environment variable errors on startup

The app validates env vars at runtime. If you see validation errors:

1. Ensure you ran `pnpm env:pull`
2. Check that `apps/web/.env.local` exists and has values
3. Check if any new variables were recently added (ask a maintainer)

### Database connection errors

1. Verify `DATABASE_URL` in `.env.local` is correct
2. Check Supabase project status at [supabase.com](https://supabase.com)
3. Ensure your IP is allowed in Supabase network settings

### Port 3000 already in use

Kill the existing process or use a different port:

```bash
pnpm dev -- --port 3001
```

## Project Conventions

Before writing code, familiarize yourself with project conventions:

- **[[../ai/conventions|Code Conventions]]** — Naming, structure, and style rules
- **README.md** — Commands reference and project overview
- **[[../ai/changelog|Changelog]]** — Recent changes (update this after significant work)

## GitHub Workflow

All non-trivial work requires a GitHub issue before starting. Commits and PRs must reference their issue.

See [[../ai/github-workflow|GitHub Workflow]] for:

- Issue creation and templates
- Branch naming conventions
- Commit message format
- PR requirements

## Next Steps

Once your environment is running:

1. Read [[../ai/conventions|Code Conventions]] to understand project patterns
2. Check [[../ai/context|Project Context]] for background on the architecture
3. Browse open issues labeled `good-first-issue` for a starting point

## Related

- [[environment-setup|Environment Setup]] — Detailed env var configuration
- [[database-workflow|Database Workflow]] — Drizzle ORM and migrations
- [[server-architecture|Server Architecture]] — tRPC routers and backend patterns
- [[_index|Back to Guides]]
