# Nexus Web App

The Next.js application behind [Nexus](../../README.md) — archival file storage on AWS S3 Glacier. This workspace holds the entire user-facing product: the App Router UI, the tRPC API, the S3/Glacier storage layer, and the Stripe billing integration.

For monorepo setup, prerequisites, and environment variables, see the [root README](../../README.md). Detailed architecture docs live in [`docs/`](../../docs/index.md).

## Routes

Production pages:

| Route                                     | What it is                                                      |
| ----------------------------------------- | --------------------------------------------------------------- |
| `/`                                       | Landing page                                                    |
| `/sign-in`, `/sign-up`, `/invite/[token]` | Auth (BetterAuth) and invite redemption                         |
| `/dashboard`                              | Storage overview: usage, file-type breakdown, active retrievals |
| `/dashboard/files`                        | File browser grouped by upload batch, with restore + download   |
| `/dashboard/upload`                       | Presigned single/multipart uploads straight to S3               |
| `/dashboard/settings`                     | Account, subscription, and billing management                   |
| `/dashboard/admin/*`                      | Admin tooling: jobs, invites, dev-tools                         |

Dev-only tooling (APIs behind these are gated to `NODE_ENV=development`):

| Route           | What it is                                                                     |
| --------------- | ------------------------------------------------------------------------------ |
| `/design`       | Component showcase for the UI kit (Tailwind + shadcn/ui)                       |
| `/dev/studio`   | tRPC devtools panel ([`packages/trpc-devtools`](../../packages/trpc-devtools)) |
| `/dev/coverage` | Live E2E coverage dashboard                                                    |
| `/dev/report`   | E2E coverage report viewer                                                     |

## Directory structure

```
apps/web/
├── app/          # App Router routes, layouts, API routes (tRPC handler, webhooks)
├── server/       # tRPC routers + services (restore state machine, billing, jobs)
├── lib/          # Client/server utilities: storage (S3/Glacier), auth, stripe, env, trpc
├── components/   # React components (shadcn/ui primitives under components/ui/)
├── e2e/          # Playwright suites (smoke/flows/admin/validate/repro) + fixtures
├── scripts/      # Workspace scripts (e2e coverage gate, ops checks, backfills)
└── types/        # Shared TypeScript types
```

The database schema and migrations are not here — they live in [`packages/db`](../../packages/db) (`@nexus/db`), which this app consumes for queries, repositories, and typed test seeding.

## Stack

Next.js 16 (App Router, React 19) · tRPC v11 for the API · Drizzle ORM against Postgres via `@nexus/db` · BetterAuth for sessions · AWS S3 for storage (every file goes to Glacier) with SNS webhooks driving restore status · Stripe for subscriptions.

## Development workflow

From the repo root (see the root README for first-time setup):

```bash
pnpm dev                       # start the app on http://localhost:3000
```

After changing the database schema (in `packages/db`):

```bash
pnpm -F db db:generate         # generate a migration
pnpm -F db db:migrate          # apply it
pnpm -F db db:studio           # inspect data in Drizzle Studio
```

Testing this workspace:

```bash
pnpm -F web test               # unit + integration (Vitest)
pnpm -F web test:e2e:smoke     # fastest E2E tier — run after any UI change
pnpm -F web test:e2e           # full Playwright suite
pnpm -F web e2e:coverage --check  # coverage gate — run after adding a page or test
```

E2E tests run against a production build on an ephemeral port, so they coexist with `pnpm dev`. Tier selection and test-data conventions: [`docs/guides/e2e-testing-guidelines.md`](../../docs/guides/e2e-testing-guidelines.md).
