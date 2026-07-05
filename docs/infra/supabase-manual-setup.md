---
title: Supabase Manual Setup
created: 2026-07-05
updated: 2026-07-05
status: active
tags:
    - infra
    - supabase
    - database
aliases:
    - Supabase Manual Setup
ai_summary: 'Manual Supabase provisioning runbook for the dev and prod database projects'
---

# Supabase Manual Setup

This documents the manual Supabase setup for the two database environments. Created 2026-07-05 (#290, part of #289).

> [!important] Ordering: create the secret before merging the workflows.
> The `DATABASE_URL_PROD` GitHub Actions secret must exist **before** merging the PR that adds the prod workflow jobs (#290). Each prod-touching workflow starts with a preflight guard that fails fast — loudly, by design — when the secret resolves empty, so the first post-merge run after that PR fails until the secret is set.

## Projects

| Project       | Purpose                                              | Plan           |
| ------------- | ---------------------------------------------------- | -------------- |
| `nexus` (dev) | Shared development DB — local dev, CI, previews, e2e | Free (pausing) |
| `nexus-prod`  | Production DB — Vercel Production deployment only    | Free (pausing) |

Both projects are on the free (pausing) plan, so both are pinged by `.github/workflows/supabase-keepalive.yml` (Mon + Thu) to stay within Supabase's ~7-day inactivity window. Nightly migration drift (`migration-drift.yml`) and the S3 event-health DB checks (`s3-event-health.yml`) also run against both.

## Create the Prod Project

1. [Supabase dashboard](https://supabase.com/dashboard) → **New project** in the same organization as the dev project.
2. Name: `nexus-prod`.
3. Region: `sa-east-1` (São Paulo) — chosen 2026-07 because the alpha testers are in Brazil. Note this deliberately differs from dev (`us-east-1`) and from the shared AWS resources; cross-region S3 latency is acceptable until prod AWS resources exist (see Follow-Ups).
4. Generate a strong database password and store it in the password manager — it is embedded in the connection string below.

No data migration is needed: prod starts empty and gets its schema from the migration pipeline (see below).

## Connection String — Transaction Pooler (Port 6543) Required

Dashboard → **Connect** → **Transaction pooler**. The URI looks like:

```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

> [!warning] Port 6543 is load-bearing, not a preference.
> `packages/db/src/connection.ts` sets `prepare: false` unconditionally because Supabase's transaction-mode pooler does not support prepared statements — statements can land on different pooled backends, which intermittently loses transactions. **Both dev and prod `DATABASE_URL`s must be transaction-pooler URLs (port 6543).** Do not use the direct connection (5432) or session pooler.

## GitHub Actions Secret

The existing `DATABASE_URL` secret stays pointed at **dev** (no rename). Add the prod pooler URL as a new secret:

```bash
gh secret set DATABASE_URL_PROD --app actions
# paste the prod transaction-pooler URL when prompted
```

Consumed by:

- `post-merge.yml` — `migrate-prod` job applies migrations to prod after the dev apply succeeds
- `migration-drift.yml` — nightly drift check (prod matrix leg)
- `supabase-keepalive.yml` — keepalive ping (prod matrix leg)
- `s3-event-health.yml` — DB health checks (prod matrix leg)

## Vercel Environment Variables

| Vercel environment | Variable       | Value                              |
| ------------------ | -------------- | ---------------------------------- |
| Production         | `DATABASE_URL` | prod transaction-pooler URL (6543) |
| Production         | `DB_ENV`       | `production`                       |
| Development        | `DB_ENV`       | `development`                      |

`DB_ENV` is the fail-closed marker for dev tooling: the seed CLI (`pnpm -F db db:seed`) refuses to run unless `DB_ENV` is set to a non-production value. Setting `DB_ENV=development` in the Vercel **Development** environment means `pnpm env:pull` writes it into `apps/web/.env.local` automatically. The dev `DATABASE_URL` in Vercel Development is unchanged.

## Apply the Initial Schema

Prod gets its schema from the same migration pipeline as dev. Either:

```bash
# Preferred: run the post-merge workflow (migrates dev, then prod)
gh workflow run post-merge.yml
```

or one-off from a local shell:

```bash
DATABASE_URL='<prod-pooler-url>' pnpm -F db db:migrate
```

## Verification

```bash
# Connectivity (same query the keepalive workflow runs)
psql '<prod-pooler-url>' -c 'select 1' -v ON_ERROR_STOP=1

# Migration journal matches the repo
DATABASE_URL='<prod-pooler-url>' pnpm -F db db:drift

# Workflows see the secret (prod legs should be green)
gh workflow run migration-drift.yml
gh workflow run supabase-keepalive.yml
```

## Follow-Ups

- **Repoint the Vercel production deployment** at the prod project: after setting the Production env vars above, redeploy production so it picks up the prod `DATABASE_URL`. Until then, the production deployment still points at dev.
- **Prod AWS resources**: `s3-event-health.yml` runs its prod leg with dev AWS credentials (no prod S3 bucket exists yet — trivially green while prod is empty). Provision prod AWS resources and secrets when a prod bucket exists; see [[aws-manual-setup|AWS Manual Setup]] for the dev pattern. Put them in `sa-east-1` to match the prod database and the Brazilian user base — uploads go browser → S3 directly, so bucket proximity to users matters more than proximity to dev infrastructure.

## Related

- [[aws-manual-setup|AWS Manual Setup]]
- [[../guides/environment-setup|Environment Setup]]
- [[../guides/database-workflow|Database Workflow]]
