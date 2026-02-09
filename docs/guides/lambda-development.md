---
title: Lambda Development
created: 2026-02-08
updated: 2026-02-08
status: active
tags:
    - guide
    - lambda
    - aws
    - backend
aliases:
    - Lambda Guide
    - Worker Guide
ai_summary: 'Lambda worker conventions, SQS job processing, and deployment patterns'
---

# Lambda Development

Conventions and patterns for the Lambda worker that processes background jobs from SQS.

> **Status:** This guide documents the target architecture. `apps/worker/` (#130) and `packages/db/` (#65) are planned but not yet implemented. Job types and repositories currently live in `apps/web/`.

## Architecture Overview

```
Web App (Next.js / Vercel)              AWS
┌─────────────────────┐    ┌──────────────────────────┐
│ tRPC procedure       │    │                          │
│   ↓                  │    │  SQS Queue               │
│ jobs.publish(db, {   │───▶│   ↓                      │
│   type, payload      │    │  Lambda Worker            │
│ })                   │    │   ↓                       │
│   ↓                  │    │  Update job status in DB  │
│ Insert DB record     │    │                          │
│ Send SQS message     │    │  (DLQ for failed msgs)   │
└─────────────────────┘    └──────────────────────────┘
          │                            │
          └────── Supabase (PostgreSQL) ──────┘
                  via connection pooler
```

**Flow:**

1. Web app inserts a `background_jobs` record (status: `pending`), then sends an SQS message
2. Lambda receives the SQS event, deserializes the message
3. Lambda looks up the job, marks it `processing`, runs the handler
4. On success: marks `completed`. On failure: marks `failed` with error message
5. Unhandled errors propagate to SQS — the message returns to the queue (or DLQ after max retries)

## Monorepo Structure

```
nexus/
├── apps/
│   ├── web/                 # Next.js (Vercel)
│   └── worker/              # Lambda worker (AWS) — #130
├── packages/
│   └── db/                  # Shared database package — #65
└── infra/terraform/         # AWS resources (SQS, Lambda, IAM)
```

Both `apps/web` and `apps/worker` depend on `packages/db` via pnpm workspace protocol. Neither app imports from the other — `packages/db` is the shared boundary.

## Shared Database Package (`packages/db`)

The database schema, repositories, and types will live in `packages/db` so both the web app and Lambda worker can use them without cross-app imports. See #65 for the extraction plan.

Key design decisions:

- **Just-in-Time compilation** — the package exports raw TypeScript. Consumers transpile it themselves.
- **`createDb(url)` factory** — each app creates its own Drizzle instance with its own connection string, avoiding coupling to any app's env validation.
- **Repositories use DI** — following the conventions in [[server-architecture#repository-layer|Server Architecture]], every function takes `db: DB` as its first parameter.

## Database Connection

Lambda functions must use Supabase's **connection pooler** (PgBouncer), not the direct connection.

| Connection Type           | Port | Use Case                               |
| ------------------------- | ---- | -------------------------------------- |
| Direct                    | 5432 | Long-lived servers (Next.js on Vercel) |
| Pooler (transaction mode) | 6543 | Serverless / short-lived (Lambda)      |

**Why the pooler?** Lambda spins up many concurrent instances that each create connections. Without pooling, you'll exhaust Supabase's connection limit. PgBouncer multiplexes many clients over fewer server connections.

**Required: disable prepared statements.** PgBouncer in transaction mode doesn't support prepared statements. Configure `postgres-js` accordingly:

```typescript
const client = postgres(url, { prepare: false });
```

The worker's `DATABASE_URL` env var should point to the pooler endpoint (port 6543).

## SQS Message Contract

The web app publishes jobs via `jobs.publish()`. The SQS message body follows this shape:

```typescript
interface SqsMessageBody {
    jobId: string;
    type: JobType;
    payload: JobPayloadMap[JobType];
}
```

These types currently live in `apps/web/lib/jobs/types.ts` and will move to `packages/db` as part of #65.

**DB-first guarantee:** The publisher inserts the database record _before_ sending the SQS message. If SQS fails, the record exists with `pending` status (safe to retry). This means the worker can always find the job record when it receives a message.

## Job Status Lifecycle

```
pending → processing → completed
                    ↘ failed
```

| Status       | Set By  | When                               |
| ------------ | ------- | ---------------------------------- |
| `pending`    | Web app | Job created, SQS message sent      |
| `processing` | Worker  | Message received, handler starting |
| `completed`  | Worker  | Handler finished successfully      |
| `failed`     | Worker  | Handler threw an error             |

The `background_jobs` table also tracks `attempts`, `error`, `startedAt`, and `completedAt`.

## Handler Pattern

The worker receives an `SQSEvent`, iterates records, and dispatches to the appropriate handler. The key responsibilities:

1. Deserialize the SQS message body into `SqsMessageBody`
2. Mark the job as `processing` (increment `attempts`, set `startedAt`)
3. Look up the handler in the registry by job type
4. On success: mark `completed`, set `completedAt`
5. On failure: mark `failed`, store error message, re-throw so SQS retries / sends to DLQ

## Job Registry

The registry maps job type strings to handler functions. Each handler receives a context with `{ jobId, payload, db }`.

Adding a new job type:

1. Add the type to `JobType` union in `packages/db`
2. Add the payload shape to `JobPayloadMap`
3. Add the handler to the registry in `apps/worker`
4. Publish from the web app using `jobs.publish(db, { type: '...', payload: {...} })`

## Build & Bundle

The worker uses **tsup** (or esbuild) to produce a single-file Lambda-compatible bundle:

```bash
pnpm -F worker build    # Produces dist/handler.js
```

Key build settings:

- Bundle all dependencies (`noExternal: [/.*/]`) — Lambda needs a self-contained artifact
- Target `node22` (matches Lambda runtime)
- The bundler resolves `packages/db` imports at build time (Just-in-Time strategy)

## Deployment

**Deploy workflow:** `pnpm -F worker build` → `terraform apply`

Terraform uses `archive_file` to zip the built artifact and deploy it as a Lambda function. Infrastructure provisioning is tracked separately. Before IaC is in place, manual deployment via the AWS CLI is possible:

```bash
cd apps/worker && pnpm build
cd dist && zip -r ../worker.zip .
aws lambda update-function-code \
    --function-name nexus-worker \
    --zip-file fileb://../worker.zip
```

## Local Testing

Lambda handlers are plain async functions — test them directly without simulating AWS. Mock the database and assert on status updates. No need for LocalStack or SAM.

```bash
pnpm -F worker test
```

## Lambda Layers (Future)

Lambda Layers allow sharing heavy dependencies across multiple Lambda functions without bundling them into each zip. Consider this when you have multiple Lambdas sharing the same heavy deps, or bundle sizes grow beyond ~50MB. For now, bundling everything into a single file is simpler and sufficient.

## Environment Variables

The worker needs its own env configuration, separate from the web app:

| Variable       | Description                                |
| -------------- | ------------------------------------------ |
| `DATABASE_URL` | Supabase connection pooler URL (port 6543) |

Additional env vars will be added as job handlers require them (e.g., S3 credentials for the delete-account handler). These are configured via Terraform's `environment` block on the Lambda resource.

## Related

- [[server-architecture|Server Architecture]] — Layered backend pattern and repository conventions
- [[storage|S3 Storage Module]] — S3 operations API
- [[../architecture/system-design|System Design]] — High-level architecture
