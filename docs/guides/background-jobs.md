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
> Both environments' queues, Lambdas, and IAM come from [`infra/terraform/`](../../infra/terraform/README.md) (prod #53, dev #127) — queue/Lambda definitions in `sqs.tf` and `lambda.tf`. Resource changes go through Terraform, including Lambda env vars (`DATABASE_URL`) — never `aws lambda update-function-configuration`. Only worker **code** deploys via the CLI (below); Terraform ignores the code package on later applies.

## Provisioned Resources

One set per environment, in `us-east-1`, account `391615358272`, suffixed `-dev` / `-prod` (exact definitions: `infra/terraform/sqs.tf`, `lambda.tf`):

| Resource              | Name pattern                                                      |
| --------------------- | ----------------------------------------------------------------- |
| SQS Queue             | `nexus-jobs-<env>` (visibility timeout 60s, 3 retries → DLQ)      |
| SQS Dead Letter Queue | `nexus-jobs-dlq-<env>`                                            |
| Lambda Function       | `nexus-worker-<env>` (Node 22, 30s timeout, 256 MB, batch size 1) |
| IAM Role (Lambda)     | `nexus-worker-role-<env>` (SQS consume, S3 CRUD, CloudWatch Logs) |
| IAM Policy (SQS user) | `nexus-sqs-access-<env>` (inline on the `nexus-app-<env>` user)   |

The examples below use dev (`nexus-worker-dev`, `nexus-jobs-dev`, …); substitute `-prod` to operate on prod.

## Deploy Updated Worker Code

```bash
# 1. Build the worker
pnpm -F worker build

# 2. Create deployment zip (include package.json for ESM)
cd apps/worker/dist
echo '{"type":"module"}' > package.json
zip -r ../worker.zip .
cd ..

# 3. Update Lambda function code
aws lambda update-function-code \
    --function-name nexus-worker-dev \
    --zip-file fileb://worker.zip \
    --region us-east-1

# 4. Verify deployment
aws lambda get-function --function-name nexus-worker-dev --region us-east-1 \
    --query 'Configuration.{State:State,LastModified:LastModified,CodeSize:CodeSize}'
```

## Lambda Environment Variables

The Lambda environment (`DATABASE_URL`) is Terraform-managed — change it with a `terraform apply` (`TF_VAR_database_url`), never `aws lambda update-function-configuration`, which Terraform would revert on the next apply.

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
