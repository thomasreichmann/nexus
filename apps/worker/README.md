# Worker

AWS Lambda function that processes background jobs from SQS.

## How It Works

The web app enqueues jobs by inserting a database record and sending an SQS message. The worker receives the message, routes it to the appropriate handler, and updates the job status (`pending` → `processing` → `completed`/`failed`). Failed jobs are retried up to 3 times before landing in a dead letter queue.

```
Web App → DB insert + SQS send → Lambda receives → handler executes → DB status update
```

## Architecture

| File              | Purpose                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `src/handler.ts`  | Lambda entry point — deserializes SQS messages, manages job lifecycle |
| `src/registry.ts` | Maps job types to handler functions                                   |
| `src/handlers/`   | Individual job handler implementations                                |

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

| Variable       | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string (pooled, port 6543 — PgBouncer) |

`DATABASE_URL` is validated at first invocation (`src/handler.ts`) and throws
a descriptive error if missing. The Lambda environment is Terraform-managed —
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
