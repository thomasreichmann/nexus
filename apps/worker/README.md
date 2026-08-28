# Worker

AWS Lambda function with two triggers: background jobs from SQS, and a
15-minute schedule that polls pending Glacier retrievals.

## How It Works

**Jobs (SQS).** The web app enqueues jobs by inserting a database record and sending an SQS message. The worker receives the message, routes it to the appropriate handler, and updates the job status (`pending` → `processing` → `completed`/`failed`). Failed jobs are retried up to 3 times before landing in a dead letter queue.

```
Web App → DB insert + SQS send → Lambda receives → handler executes → DB status update
```

**Retrieval poll (EventBridge).** Every 15 minutes, EventBridge invokes the same function with a payload that has no `Records` key, which is how `handler` tells the two apart. The poll `HeadObject`s each _pending_ retrieval, marks the readable ones `ready`, and re-enqueues any thumbnail that failed while its original was cold.

```
EventBridge (15m) → Lambda → HeadObject per pending retrieval → mark ready
```

This replaced an S3 → SNS → webhook rail (#416). Completion is observed rather than delivered, so the request volume is bounded by our own pending set instead of by S3's event rate. Rows are processed serially: exactly one query is in flight at a time, so the connection pooler never sees more than one connection from a run.

## Architecture

| File                    | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `src/handler.ts`        | Lambda entry point — branches on event shape, manages job lifecycle |
| `src/pollRetrievals.ts` | The scheduled retrieval poll                                        |
| `src/jobs.ts`           | Publishes jobs to SQS (the poll re-enqueues thumbnails)             |
| `src/registry.ts`       | Maps job types to handler functions                                 |
| `src/handlers/`         | Individual job handler implementations                              |

Job types and payloads are defined in `packages/db` (`@nexus/db`), shared with the web app.

## Adding a New Job Handler

1. Add the job type and payload to `packages/db/src/jobs/types.ts`
2. Create a handler in `src/handlers/` (async function receiving the payload)
3. Register it in `src/handlers/index.ts`

## Commands

From the monorepo root:

```bash
pnpm -F worker build       # Bundle to dist/handler.js
pnpm -F worker test         # Run tests
pnpm -F worker lint         # Lint
```

There is no local runner: the worker only ever executes as a Lambda. To
exercise the retrieval poll without waiting up to 15 minutes for the schedule,
invoke the deployed function with an empty payload — the same shape EventBridge
sends. Recipe in the
[Background Jobs Runbook](../../docs/guides/background-jobs.md#run-the-retrieval-poll-on-demand).

## Environment

The worker does not read `.env` files or Vercel env, and does not use the web
app's Zod schema. Its environment is set per-environment on the Lambda
function configuration:

| Variable                        | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`                  | Postgres connection string (pooled, port 6543 — PgBouncer)        |
| `S3_BUCKET`                     | Files bucket — thumbnail sources, the retrieval poll, zip sources |
| `S3_DERIVED_BUCKET`             | Derived bucket — generated thumbnails                             |
| `S3_RETRIEVAL_ARTIFACTS_BUCKET` | Artifacts bucket — the zips a restore is delivered as             |
| `SQS_QUEUE_URL`                 | Jobs queue, for the jobs the poll enqueues                        |
| `SQS_ZIP_QUEUE_URL`             | Zip-build queue — the second function's queue                     |
| `APP_URL`                       | Link target for worker-sent email — the app, not a presigned URL  |
| `RESEND_API_KEY`                | Read by `@nexus/email`; empty means the worker can't send         |
| `RESEND_FROM_EMAIL`             | Read by `@nexus/email` — the visible From address                 |
| `ANALYTICS_ENABLED`             | Read by `@nexus/analytics`; `"true"` turns capture on             |
| `POSTHOG_KEY`                   | PostHog project key; absent leaves analytics off                  |
| `ANALYTICS_ENVIRONMENT`         | `production` / `development` — the tier events are attributed to  |

The ones the worker reads itself are validated at first use and throw a
descriptive error if missing (`requireEnv` in `src/aws.ts`); the ones marked as
read by a package are validated there instead, the same way in both runtimes.
The Lambda environment is Terraform-managed — change it with a
`terraform apply` (`TF_VAR_database_url`, `TF_VAR_resend_api_key`, and the
committed tfvars for the rest; see `infra/terraform/README.md`), never
`aws lambda update-function-configuration`, which Terraform would revert on
the next apply.

## Deployment

The build produces a single self-contained ES module (`dist/handler.js`) with
all dependencies bundled. Code deploys automatically on every merge to main
(`post-merge.yml` → `scripts/deploy.sh`, dev then prod, after each
environment's migration). For a first deploy, rollback, or hotfix run the same
script manually: `pnpm -F worker deploy:<env>` — details in the
[Background Jobs Runbook](../../docs/guides/background-jobs.md#deploy-updated-worker-code).

**One bundle, two functions.** `nexus-worker-<env>` runs the SQS jobs and the
15-minute retrieval poll; `nexus-worker-zip-<env>` runs only zip builds, which
need Lambda's 900s maximum (#424). They share this code and their handler
registry, so `deploy.sh` updates both in one run — a half-deployed pair would
have two versions of the same registry answering the same job types.

`deploy.sh` uploads the zip directly (`aws lambda update-function-code
--zip-file`), so the ceiling is 50 MB zipped / 250 MB unzipped including the
ffmpeg and exiftool layers. The shipped bundle is 271 KB zipped, unchanged by
#425: `@nexus/email` is declared but not yet imported from `src/`, and tsup
bundles only what the `src/handler.ts` entry reaches. A throwaway build that
did import the whole notification path (React Email and react-dom through
`@nexus/email`, plus `@nexus/analytics`) measured 763 KB — about 1.5% of the
limit, so #426 has no reason to move JS dependencies into a layer.

## Key Details

- **Runtime:** Node.js 22, ES modules
- **Database:** Connects via Supabase PgBouncer (port 6543) with `prepare: false` to handle Lambda's concurrent execution model
- **Bundler:** tsup (esbuild) — bundles all dependencies into a single file
- **Infrastructure:** Terraform-managed — see `infra/terraform/` (queues, Lambda, IAM for both environments)
