---
title: Environment Setup
created: 2025-12-30
updated: 2026-07-05
status: active
tags:
    - guide
    - environment
    - configuration
aliases:
    - Env Setup
    - Environment Variables
---

# Environment Setup

Environment variable management and configuration strategy for Nexus.

## Overview

Nexus runs on **two Supabase projects** — dev and prod — with a cloud-only development model:

- **Two databases** - A shared dev project (local dev, CI, previews, e2e) and a separate prod project used only by the Vercel Production deployment. See [[../infra/supabase-manual-setup|Supabase Manual Setup]].
- **Cloud-only development** - Local dev connects to the cloud dev Supabase (no local Docker)
- **Single `.env.local`** - Contains cloud **dev** credentials pulled from Vercel; local tooling never touches prod
- **Vercel as source of truth** - Variables configured once in Vercel dashboard, per environment
- **Type-safe validation** - Zod validates at runtime
- **Migrations to both** - `post-merge.yml` applies migrations to dev, then to prod once the dev apply succeeds

> [!note] Why cloud-only?
> Managing local database containers adds complexity. We use the cloud dev environment for all local development. This requires an internet connection but eliminates env file juggling. Prod is reached only by the Vercel Production deployment and by CI workflows via the `DATABASE_URL_PROD` GitHub Actions secret.

## Quick Start

```bash
# Link project to Vercel (first time only)
vercel link

# Pull environment variables
pnpm env:pull
```

This creates `apps/web/.env.local` with all variables from your Vercel Development environment.

`apps/web/.env.local` is the single env source for all local tooling —
`packages/db` (drizzle-kit, seed CLI), `tooling/capture`, and the e2e suite
all load it via hardcoded relative paths. This is a deliberate dev-only
assumption: deployed code (Vercel, Lambda) never reads `.env` files. Because
it is pulled from the Vercel **Development** environment, it always points at
the dev database — local tooling never touches prod.

## File Structure

```
apps/web/
├── .env.example      # Template for reference (committed)
├── .env.local        # Pulled from Vercel (gitignored)
└── lib/
    └── env.ts        # Type-safe validation
```

## Environment Variables

### Database (Drizzle)

Direct PostgreSQL connection for Drizzle ORM queries.

| Variable       | Type   | Description                                                                    |
| -------------- | ------ | ------------------------------------------------------------------------------ |
| `DATABASE_URL` | Server | PostgreSQL connection string (dev DB locally; prod DB in Vercel Production)    |
| `DB_ENV`       | Server | Environment marker (`development` / `production`) — fail-closed seed-CLI guard |

> [!warning] Connection Pooling
> **Every environment** must use the transaction-pooler connection string (port 6543), not the direct connection (port 5432). `packages/db/src/connection.ts` sets `prepare: false` unconditionally, which assumes transaction-pooler mode.

> [!note] DB_ENV guard
> The seed CLI (`pnpm -F db db:seed`) refuses to run unless `DB_ENV` is set to a non-production value. Missing `DB_ENV` also refuses (fail-closed). Set `DB_ENV=development` in the Vercel Development environment so `pnpm env:pull` writes it into `.env.local`.

The `DATABASE_URL_PROD` GitHub Actions secret (not a Vercel/app variable) points CI workflows — post-merge prod migrate, drift check, keepalive, event health — at the prod database. See [[../infra/supabase-manual-setup|Supabase Manual Setup]].

### Authentication (BetterAuth)

Secret key for session signing and token generation.

| Variable             | Type   | Description                             |
| -------------------- | ------ | --------------------------------------- |
| `BETTER_AUTH_SECRET` | Server | Random 32+ character string for signing |

### AWS S3

File storage credentials for S3/Glacier operations.

| Variable                | Type   | Description                       |
| ----------------------- | ------ | --------------------------------- |
| `AWS_ACCESS_KEY_ID`     | Server | IAM access key                    |
| `AWS_SECRET_ACCESS_KEY` | Server | IAM secret key                    |
| `AWS_REGION`            | Server | AWS region (e.g., `us-east-1`)    |
| `S3_BUCKET`             | Server | S3 bucket name                    |
| `SQS_QUEUE_URL`         | Server | Queue URL for S3 event processing |

### Stripe

Payment processing credentials. Server-side only — there is no Stripe.js on the client, so no publishable key is needed.

| Variable                | Type   | Description            |
| ----------------------- | ------ | ---------------------- |
| `STRIPE_SECRET_KEY`     | Server | Secret key             |
| `STRIPE_WEBHOOK_SECRET` | Server | Webhook signing secret |

### Email (Resend)

Transactional email credentials.

| Variable            | Type   | Description                                    |
| ------------------- | ------ | ---------------------------------------------- |
| `RESEND_API_KEY`    | Server | Resend API key                                 |
| `RESEND_FROM_EMAIL` | Server | From address (`Name <addr@domain>` also works) |

### App

Application-level configuration.

| Variable              | Type   | Description                                                            |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL` | Public | Base URL of the application                                            |
| `LOG_ERROR_VERBOSITY` | Server | Optional: `minimal` \| `standard` \| `full` (defaults per environment) |

### Worker (AWS Lambda)

`apps/worker` does not use Vercel env or the web app's Zod schema. Its
environment (`DATABASE_URL`) is set per-environment on the Lambda function
configuration — see `apps/worker/README.md`.

## Type-Safe Access

All environment variables are validated at startup using Zod. Import from `@/lib/env`:

```typescript
import { env } from '@/lib/env';

// Type-safe, validated at runtime
const bucket = env.S3_BUCKET;
const authSecret = env.BETTER_AUTH_SECRET;
```

### Benefits

- **Fail fast** - App won't start if required vars are missing
- **TypeScript autocomplete** - Full IntelliSense support
- **Single source of truth** - One place for all env var definitions
- **Server/client separation** - Clear distinction prevents leaking secrets

## Vercel Environment Management

Three Vercel tiers back the two infrastructure environments (#291):

- **Production** → the isolated **prod** infra (prod Supabase, `-prod` AWS resources).
- **Preview** and **Development** → the shared **dev** infra. `pnpm env:pull` pulls Development, so local tooling always lands on dev.

### Which values differ per tier

Only the vars below hold prod-specific values on Production; everything else is
shared with dev (or is out of scope for the split).

| Variable                                      | Production                                                | Preview / Development     |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| `DATABASE_URL`                                | prod Supabase pooler                                      | dev Supabase pooler       |
| `DB_ENV`                                      | `production`                                              | `development`             |
| `S3_BUCKET`                                   | `nexus-storage-files-prod`                                | `nexus-storage-files-dev` |
| `SQS_QUEUE_URL`                               | `…/nexus-jobs-prod`                                       | `…/nexus-jobs-dev`        |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | access key on the `nexus-app-prod` IAM user               | `nexus-app-dev` key       |
| `BETTER_AUTH_SECRET`                          | prod-only secret (rotating it never touches dev sessions) | dev secret                |
| `NEXT_PUBLIC_APP_URL`                         | `https://nexus.thomasar.dev`                              | `http://localhost:3000`\* |

\* Exception: the long-lived `dev` branch (the deployment that receives dev SNS
webhooks, #127) has a branch-scoped Preview value pointing at its own URL
(`https://dev.nexus.thomasar.dev`, the custom domain #317 pinned to the branch)
so dev-triggered emails don't link to localhost. It shows as `Preview (dev)` in
`vercel env ls`.

Same on every tier: `AWS_REGION` (`us-east-1`), Resend. **Out of scope:** Stripe
stays test-mode on Production until live mode ships (#213). The prod AWS resource
names come from `infra/terraform/outputs.tf`; create the `nexus-app-prod` access
key manually (`aws iam create-access-key --user-name nexus-app-prod`).

> [!warning] Per-tier edits via the CLI
> Some vars are stored as a **single entry attached to all three tiers** (they
> show one row spanning `Production, Preview, Development` in `vercel env ls`).
> `vercel env rm NAME production` on such a var removes it from **every** tier,
> not just Production. To give one tier a distinct value, remove and re-add it
> **per environment** (`vercel env add NAME development`, `… preview`,
> `… production`) so the others keep theirs. After any change, `vercel env pull
--environment=development` and confirm dev is intact.

### Adding New Variables

1. Add in Vercel dashboard for all environments
2. Pull locally: `pnpm env:pull`
3. Add to `lib/env/schema.ts` (server or client schema)
4. Update `.env.example` for reference
5. Update this documentation

### Parity Checks (CI)

`env-parity.yml` runs nightly (#293) and backstops the manual processes above:

- `pnpm -F web check:stripe-config` — asserts products/prices/webhook wiring
  in whichever Stripe mode its `STRIPE_SECRET_KEY` selects (test mode until
  #213 adds a live leg).
- `pnpm -F web check:vercel-env-parity` — fails when an env-var **key**
  exists in some tiers but not others (values may differ per tier; keys may
  not). Intentional asymmetries go in the script's `ASYMMETRY_ALLOWLIST`.
  Needs the `VERCEL_TOKEN` GitHub Actions secret — a token from
  vercel.com/account/tokens, team-scoped and with an expiry. Vercel tokens
  can't be scoped read-only: this token can also _write_ env vars, so treat
  it as a real credential.

The prod DB health leg (`check:s3-event-health`) already runs nightly for
both environments via the dev/prod matrix in `s3-event-health.yml`
(`DATABASE_URL_PROD` secret).

## Related

- [[getting-started|Getting Started]]
- [[tech-stack|Tech Stack]]
- [[guides/_index|Back to Guides]]
