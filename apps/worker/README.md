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

## Environment

The worker does not read `.env` files or Vercel env, and does not use the web
app's Zod schema. Its environment is set per-environment on the Lambda
function configuration:

| Variable            | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`      | Postgres connection string (pooled, port 6543 — PgBouncer) |
| `S3_BUCKET`         | Files bucket — thumbnail sources and the retrieval poll    |
| `S3_DERIVED_BUCKET` | Derived bucket — generated thumbnails                      |
| `SQS_QUEUE_URL`     | Jobs queue, for the jobs the poll enqueues                 |

Each is validated at first use and throws a descriptive error if missing. The Lambda environment is Terraform-managed —
change it with a `terraform apply` (`TF_VAR_database_url`, see
`infra/terraform/README.md`), never `aws lambda update-function-configuration`,
which Terraform would revert on the next apply.

## Deployment

The build produces a single self-contained ES module (`dist/handler.js`) with
all dependencies bundled. Deploy with `aws lambda update-function-code`
against `nexus-worker-<env>` — full recipe in the
[Background Jobs Runbook](../../docs/guides/background-jobs.md#deploy-updated-worker-code).

## Key Details

- **Runtime:** Node.js 22, ES modules
- **Database:** Connects via Supabase PgBouncer (port 6543) with `prepare: false` to handle Lambda's concurrent execution model
- **Bundler:** tsup (esbuild) — bundles all dependencies into a single file
- **Infrastructure:** Terraform-managed — see `infra/terraform/` (queues, Lambda, IAM for both environments)
