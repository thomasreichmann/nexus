---
title: Background Jobs Runbook
created: 2026-02-15
updated: 2026-07-11
status: active
tags:
    - guide
    - aws
    - infra
    - backend
aliases:
    - Background Jobs
    - SQS Runbook
ai_summary: 'Worker deployment, DLQ inspection, test jobs, logs, and integration tests; provisioning lives in Terraform'
---

# Background Jobs Runbook

Operational guide for the SQS + Lambda background job infrastructure. For development patterns and conventions, see [[lambda-development|Lambda Development]].

> [!important] Provisioning lives in Terraform — this doc is operations only.
> Both environments' queues, Lambdas, and IAM come from [`infra/terraform/`](../../infra/terraform/README.md) (prod #53, dev #127) — queue/Lambda definitions in `sqs.tf` and `lambda.tf`. Resource changes go through Terraform, including Lambda env vars (`DATABASE_URL`, `SQS_QUEUE_URL`, the zip-pipeline vars added in #424, and the notification vars added in #425) — never `aws lambda update-function-configuration`. Only worker **code** deploys via the CLI (below); Terraform ignores the code package on later applies.

## Provisioned Resources

One set per environment, in `us-east-1`, account `391615358272`, suffixed `-dev` / `-prod` (exact definitions: `infra/terraform/sqs.tf`, `lambda.tf`, `scheduler.tf`):

| Resource              | Name pattern                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| SQS Queue             | `nexus-jobs-<env>` (visibility timeout 720s, 3 retries → DLQ)                                           |
| SQS Dead Letter Queue | `nexus-jobs-dlq-<env>` (depth > 0 alarms → Discord, plus email in prod, `alarms.tf`)                    |
| SQS Zip Queue         | `nexus-zip-jobs-<env>` (visibility timeout 5400s, 3 retries → DLQ)                                      |
| SQS Zip DLQ           | `nexus-zip-jobs-dlq-<env>` (depth > 0 alarms; redrive before the thawed originals lapse)                |
| Lambda Function       | `nexus-worker-<env>` (Node 22, 120s timeout, 1 GB, batch size 1, ffmpeg + exiftool layers)              |
| Lambda Function (zip) | `nexus-worker-zip-<env>` (Node 22, 900s timeout, 2 GB, batch size 1, reserved concurrency 5, no layers) |
| Lambda Layers         | `nexus-ffmpeg-<env>`, `nexus-exiftool-<env>` (`layers.tf`; built by `lambda-layers.yml` CI)             |
| IAM Role (Lambda)     | `nexus-worker-role-<env>` (SQS consume + send, S3 CRUD, derived-bucket Put/Get, CloudWatch Logs)        |
| EventBridge Schedule  | `nexus-retrieval-poll-<env>` (every 15 min → the general Lambda; `scheduler.tf`)                        |
| Lambda Errors Alarm   | `nexus-worker-errors-<env>` (>3 errors/hour → Discord; the scheduled path has no DLQ)                   |
| IAM Policy (SQS user) | `nexus-sqs-access-<env>` (inline on the `nexus-app-<env>` user)                                         |

Both Lambdas run the same bundle and register the same handlers; the queue a
job is published to decides which one runs it (`queueUrlFor` in
`apps/worker/src/jobs.ts`). `deploy.sh` therefore updates both functions.

The examples below use dev (`nexus-worker-dev`, `nexus-jobs-dev`, …); substitute `-prod` to operate on prod.

## Deploy Updated Worker Code

Worker code deploys **automatically on every merge to main**: `post-merge.yml`
runs `apps/worker/scripts/deploy.sh` against dev after the dev migration, then
against prod after the prod migration (as `nexus-deploy-<env>`, an IAM user
scoped to `UpdateFunctionCode` on the worker function).

Run the same script manually for a first deploy, rollback, or hotfix:

```bash
pnpm -F worker deploy:dev   # or: deploy:prod
```

It builds, zips (with the ESM `package.json`), calls
`aws lambda update-function-code`, waits for the update to settle, and
verifies the deployed `CodeSha256` matches the local zip.

## Lambda Environment Variables

The Lambda environment (full table in `apps/worker/README.md`) is Terraform-managed — change it with a `terraform apply` (`TF_VAR_database_url`, `TF_VAR_resend_api_key`; the rest come from the committed tfvars), never `aws lambda update-function-configuration`, which Terraform would revert on the next apply.

## Lambda Layers (ffmpeg, perl/exiftool)

The `generate-thumbnail` handler shells out to binaries mounted from two
Terraform-owned layers (`infra/terraform/layers.tf`). The zips are built
reproducibly from pinned upstream sources by the `lambda-layers.yml` workflow
(scripts in `tooling/lambda-layers/`) and flow to the Lambda via the
`nexus-lambda-artifacts-<env>` bucket:

```bash
# 1. Download the zips from the latest lambda-layers workflow run
gh run download -n ffmpeg-layer -n exiftool-layer -D /tmp/layers

# 2. Sync them into the environment's artifacts bucket
infra/terraform/scripts/upload-layers.sh dev /tmp/layers

# 3. Publish the layer versions + attach to the worker
terraform apply -var-file=environments/dev.tfvars
```

Version bumps change the pins in `tooling/lambda-layers/*.sh` AND the
matching locals in `infra/terraform/layers.tf` (the s3 key embeds the
versions, so a mismatched apply fails fast on a missing object).

## Inspect Dead Letter Queue

Messages that fail 3 times are moved to the DLQ. Inspect them to debug failures.

```bash
# Check how many messages are in the DLQ
aws sqs get-queue-attributes \
    --queue-url https://sqs.us-east-1.amazonaws.com/391615358272/nexus-jobs-dlq-dev \
    --attribute-names ApproximateNumberOfMessages \
    --region us-east-1

# Read messages from DLQ (does not delete them)
aws sqs receive-message \
    --queue-url https://sqs.us-east-1.amazonaws.com/391615358272/nexus-jobs-dlq-dev \
    --max-number-of-messages 10 \
    --region us-east-1 | jq '.Messages[] | .Body | fromjson'

# Purge all DLQ messages (after investigating)
aws sqs purge-queue \
    --queue-url https://sqs.us-east-1.amazonaws.com/391615358272/nexus-jobs-dlq-dev \
    --region us-east-1
```

## Send a Test Job

Send a test message directly to SQS (bypasses the web app's `jobs.publish()`):

```bash
# Create a test job record in the DB first, then:
aws sqs send-message \
    --queue-url https://sqs.us-east-1.amazonaws.com/391615358272/nexus-jobs-dev \
    --message-body '{"jobId":"test-123","type":"test-echo","payload":{}}' \
    --region us-east-1
```

> **Note:** The worker expects a matching `background_jobs` record in the database. Sending a message without a DB record will cause the job to fail with a "not found" error.

## Run the Retrieval Poll On Demand

EventBridge invokes the worker every 15 minutes (`scheduler.tf`), but you rarely
want to wait a tick to see whether a restore has landed. The schedule's payload
is just `{}` — the handler branches on the _absence_ of a `Records` key — so any
empty invoke exercises exactly the scheduled path:

```bash
aws lambda invoke \
    --function-name nexus-worker-dev \
    --payload '{}' --cli-binary-format raw-in-base64-out \
    --region us-east-1 \
    /dev/stdout
```

The response body is the poll's summary — `checked`, `ready`, `waiting`,
`missing`, `errored`, `capped` — which is also logged to the function's log
group (see [View Lambda Logs](#view-lambda-logs)). It is idempotent and bounded
by the pending-retrieval set, so running it back to back is safe.

`missing` counts rows whose object is no longer in the bucket; those are marked
`failed` rather than re-checked forever. A run where **every** row errors throws,
which is what surfaces a total S3/IAM outage on the `nexus-worker-errors` alarm —
the scheduled path has no DLQ to catch it.

## View Lambda Logs

```bash
# Recent log streams
aws logs describe-log-streams \
    --log-group-name /aws/lambda/nexus-worker-dev \
    --order-by LastEventTime --descending \
    --limit 5 \
    --region us-east-1 | jq '.logStreams[].logStreamName'

# Tail recent logs (requires aws logs CLI v2)
aws logs tail /aws/lambda/nexus-worker-dev --since 1h --region us-east-1

# Get logs from a specific invocation
aws logs get-log-events \
    --log-group-name /aws/lambda/nexus-worker-dev \
    --log-stream-name '<stream-name>' \
    --region us-east-1 | jq '.events[].message'
```

## Provisioning and Decommissioning

All of it is Terraform: `infra/terraform/` defines the queues, DLQ, Lambda,
IAM role, and event source mapping per environment ([README](../../infra/terraform/README.md)
has the apply/destroy flow). The CLI provisioning commands that used to live
here built the original hand-made dev stack, decommissioned in #127.

## Integration Tests

Automated publish-side integration tests verify the web app's `jobs.publish()` flow against real AWS SQS and the dev database (DB record insertion + SQS message publish).

### Prerequisites

- `.env.local` in `apps/web/` with: `DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SQS_QUEUE_URL`
- Network access to the dev database and AWS SQS

### Running

```bash
pnpm -F web test:integration
```

### How it works

- Uses a separate vitest config (`vitest.integration.config.ts`) with `node` environment
- Loads env vars from `.env.local` via dotenv in the setup file
- Excluded from the default `pnpm test` run (only `*.integration.test.ts` files)
- Connects to the real database via `createDb()` and calls `jobs.publish()` with real SQS credentials
- Asserts that a `background_jobs` record is created with status `pending` and that the SQS publish resolves without error
- Cleans up test DB records in `afterAll`

> **Note:** The dev Lambda event source mapping is active, so test messages will be consumed by the real worker, which may transition the job's status (e.g. to `failed`) at any point after publish. The test therefore asserts only on publish-owned state — the returned row and the inserted fields — never on `status` re-read from the DB (#262).

## Related

- [[lambda-development|Lambda Development]] — Worker conventions and job handler patterns
- [`infra/terraform/`](../../infra/terraform/README.md) — resource definitions for both environments
- [[../architecture/system-design|System Design]] — High-level architecture
