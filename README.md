# Nexus

Deep storage made simple.

Nexus is a cost-effective archival solution using AWS S3 Glacier. Think "Dropbox for archival" — upload files you want to keep long-term without paying for instant access you don't need.

## Features

- **Glacier-first storage** — Files default to Deep Archive for maximum cost savings
- **Transparent retrieval** — Clear status updates during 3-12 hour restore windows
- **Secure transfers** — Presigned URLs for uploads and downloads
- **Subscription billing** — Simple tier-based pricing via Stripe

## Tech Stack

| Layer     | Technology                         |
| --------- | ---------------------------------- |
| Framework | Next.js 16, React 19, TypeScript   |
| Database  | Supabase (PostgreSQL), Drizzle ORM |
| Storage   | AWS S3 Glacier                     |
| Auth      | BetterAuth                         |
| API       | tRPC v11                           |
| Payments  | Stripe                             |
| UI        | Tailwind, shadcn/ui                |
| Monorepo  | pnpm workspaces, Turborepo         |

## Prerequisites

- Node.js 22+
- pnpm 9+
- Vercel CLI
- AWS account with S3 access
- Supabase project

## Quick Start

```bash
git clone <repo-url>
cd nexus
pnpm install
vercel link && pnpm env:pull
pnpm -F web db:migrate
pnpm dev
```

## Project Structure

```
nexus/
├── apps/web/           # Next.js application
│   ├── app/            # App Router pages
│   ├── components/     # UI components
│   ├── server/         # tRPC routers, Drizzle schema
│   └── lib/            # Utilities, auth, env validation
├── docs/               # Documentation (Obsidian vault)
└── infra/              # Terraform infrastructure
```

## Commands

```bash
pnpm dev              # Start dev server
pnpm build            # Build all workspaces
pnpm lint             # Run ESLint
pnpm test             # Run tests
pnpm typecheck        # TypeScript check
```

Database commands (run from root with `-F web`):

```bash
pnpm -F web db:generate    # Generate migration from schema
pnpm -F web db:migrate     # Apply migrations
pnpm -F web db:studio      # Open Drizzle Studio
```

## Environment Variables

Environment variables are managed via Vercel and validated at runtime. After running `pnpm env:pull`, configure:

| Category | Variables                                                                     |
| -------- | ----------------------------------------------------------------------------- |
| Database | `DATABASE_URL`                                                                |
| Auth     | `BETTER_AUTH_SECRET`                                                          |
| AWS      | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`       |
| Stripe   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLIC_KEY` |
| App      | `NEXT_PUBLIC_APP_URL`                                                         |

See `apps/web/lib/env/` for type-safe access.

## Documentation

Detailed documentation lives in [`docs/`](docs/index.md) (Obsidian vault):

| Section                                     | Description                                        |
| ------------------------------------------- | -------------------------------------------------- |
| [Architecture](docs/architecture/_index.md) | System design, tech stack, principles              |
| [Guides](docs/guides/_index.md)             | Getting started, database workflow, patterns       |
| [Planning](docs/planning/_index.md)         | Roadmap and MVP scope                              |
| [Decisions](docs/decisions/_index.md)       | Architecture Decision Records                      |
| [AI Context](docs/ai/_index.md)             | Conventions, patterns, changelog for AI assistants |

New contributors: start with [Getting Started](docs/guides/getting-started.md) and [Conventions](docs/ai/conventions.md).
