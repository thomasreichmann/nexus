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
3. Region: `us-east-1` — matches dev and the prod AWS resources. A São Paulo (`sa-east-1`) deployment closer to the Brazil alpha testers was trialed 2026-07 but reverted 2026-07-09: the latency win didn't justify the ~3.2× Glacier Deep Archive cost markup in South America. Multi-region is deferred until we validate that tradeoff.
4. Generate a strong database password and store it in the password manager — it is embedded in the connection string below.

No data migration is needed: prod starts empty and gets its schema from the migration pipeline (see below).

## Connection String — Transaction Pooler (Port 6543) Required

Dashboard → **Connect** → **Transaction pooler**. The URI looks like:

```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

> [!warning] Port 6543 is load-bearing, not a preference.
> `packages/db/src/connection.ts` sets `prepare: false` unconditionally because Supabase's transaction-mode pooler does not support prepared statements — statements can land on different pooled backends, which intermittently loses transactions. **Both dev and prod `DATABASE_URL`s must be transaction-pooler URLs (port 6543).** Do not use the direct connection (5432) or session pooler.

## GitHub Actions Secrets

Every prod-scoped secret the nightly workflows need, Supabase and otherwise —
`docs/infra/aws-manual-setup.md` is superseded, so the AWS ones live here too.

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

That workflow's prod leg also compares `files` rows against the prod bucket, so
it needs prod AWS credentials in the same matrix (#318). The key belongs to
`nexus-ci-prod` — a read-only IAM user Terraform creates for exactly this, so a
nightly job never holds write access to production data:

```bash
aws iam create-access-key --user-name nexus-ci-prod

gh secret set AWS_ACCESS_KEY_ID_PROD --app actions
gh secret set AWS_SECRET_ACCESS_KEY_PROD --app actions
gh secret set S3_BUCKET_PROD --app actions   # nexus-storage-files-prod
```

`AWS_REGION` stays shared — both environments live in `us-east-1`.

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

- ~~Repoint the Vercel production deployment at the prod project~~ — done in #291 (PR #315); Production runs on the prod `DATABASE_URL` and prod AWS resources.
- ~~**`s3-event-health.yml` prod leg** runs with dev AWS credentials~~ — fixed in #318; the AWS key and bucket are matrixed per env alongside `DATABASE_URL`.

## Related

- [[aws-manual-setup|AWS Manual Setup]]
- [[../guides/environment-setup|Environment Setup]]
- [[../guides/database-workflow|Database Workflow]]
