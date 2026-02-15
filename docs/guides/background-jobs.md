---
title: Background Jobs Runbook
created: 2026-02-15
updated: 2026-02-15
status: active
tags:
    - guide
    - aws
    - infra
    - backend
aliases:
    - Background Jobs
    - SQS Runbook
ai_summary: 'AWS resource ARNs, CLI provisioning commands, deployment, DLQ inspection, and test job instructions'
---

# Background Jobs Runbook

Operational guide for the SQS + Lambda background job infrastructure. For development patterns and conventions, see [[lambda-development|Lambda Development]].

## Provisioned Resources

| Resource              | Name / ARN                                                                       |
| --------------------- | -------------------------------------------------------------------------------- |
| SQS Queue             | `nexus-jobs-dev` — `arn:aws:sqs:us-east-1:391615358272:nexus-jobs-dev`           |
| SQS Dead Letter Queue | `nexus-jobs-dlq-dev` — `arn:aws:sqs:us-east-1:391615358272:nexus-jobs-dlq-dev`   |
| Lambda Function       | `nexus-worker` — `arn:aws:lambda:us-east-1:391615358272:function:nexus-worker`   |
| IAM Role (Lambda)     | `nexus-worker-role-dev` — `arn:aws:iam::391615358272:role/nexus-worker-role-dev` |
| IAM Policy (SQS user) | `nexus-sqs-access-dev` (inline on `nexus-app-dev` user)                          |
| SQS Queue URL         | `https://sqs.us-east-1.amazonaws.com/391615358272/nexus-jobs-dev`                |
| Region                | `us-east-1`                                                                      |

### Lambda Configuration

- **Runtime:** Node.js 22.x
- **Handler:** `handler.handler`
- **Timeout:** 30 seconds
- **Memory:** 256 MB
- **SQS Trigger:** Batch size 1 (one job per invocation)
- **DLQ Policy:** Messages retry 3 times before moving to DLQ

### IAM Policies on Lambda Role

| Policy Name             | Permissions                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `nexus-worker-sqs-dev`  | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`   |
| `nexus-worker-s3-dev`   | S3 CRUD on `nexus-storage-files-dev`                                  |
| `nexus-worker-logs-dev` | CloudWatch Logs (`CreateLogGroup`, `CreateLogStream`, `PutLogEvents`) |

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
    --function-name nexus-worker \
    --zip-file fileb://worker.zip \
    --region us-east-1

# 4. Verify deployment
aws lambda get-function --function-name nexus-worker --region us-east-1 \
    --query 'Configuration.{State:State,LastModified:LastModified,CodeSize:CodeSize}'
```

## Update Lambda Environment Variables

```bash
# Add or update environment variables
aws lambda update-function-configuration \
    --function-name nexus-worker \
    --environment 'Variables={DATABASE_URL=<pooler-url>,NEW_VAR=value}' \
    --region us-east-1
```

> **Note:** This replaces all environment variables — include existing ones when updating.

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
    --log-group-name /aws/lambda/nexus-worker \
    --order-by LastEventTime --descending \
    --limit 5 \
    --region us-east-1 | jq '.logStreams[].logStreamName'

# Tail recent logs (requires aws logs CLI v2)
aws logs tail /aws/lambda/nexus-worker --since 1h --region us-east-1

# Get logs from a specific invocation
aws logs get-log-events \
    --log-group-name /aws/lambda/nexus-worker \
    --log-stream-name '<stream-name>' \
    --region us-east-1 | jq '.events[].message'
```

## Provisioning Commands (Reproducible)

These are the CLI commands used to create the infrastructure. Run them to recreate in a new environment.

### 1. Dead Letter Queue

```bash
aws sqs create-queue --queue-name nexus-jobs-dlq-dev --region us-east-1
```

### 2. Standard Queue with Redrive Policy

```bash
DLQ_ARN=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/nexus-jobs-dlq-dev \
    --attribute-names QueueArn --region us-east-1 \
    --query 'Attributes.QueueArn' --output text)

aws sqs create-queue \
    --queue-name nexus-jobs-dev \
    --region us-east-1 \
    --attributes "{
        \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\",
        \"VisibilityTimeout\": \"60\"
    }"
```

### 3. IAM Execution Role

```bash
aws iam create-role \
    --role-name nexus-worker-role-dev \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }'
```

### 4. IAM Policies

```bash
# SQS consume
aws iam put-role-policy \
    --role-name nexus-worker-role-dev \
    --policy-name nexus-worker-sqs-dev \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": ["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"],
            "Resource": "arn:aws:sqs:us-east-1:<ACCOUNT_ID>:nexus-jobs-dev"
        }]
    }'

# S3 access
aws iam put-role-policy \
    --role-name nexus-worker-role-dev \
    --policy-name nexus-worker-s3-dev \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": ["s3:PutObject","s3:GetObject","s3:DeleteObject","s3:ListBucket","s3:RestoreObject","s3:GetObjectAttributes"],
            "Resource": ["arn:aws:s3:::nexus-storage-files-dev","arn:aws:s3:::nexus-storage-files-dev/*"]
        }]
    }'

# CloudWatch Logs
aws iam put-role-policy \
    --role-name nexus-worker-role-dev \
    --policy-name nexus-worker-logs-dev \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],
            "Resource": "arn:aws:logs:us-east-1:<ACCOUNT_ID>:*"
        }]
    }'

# SQS send (for web app IAM user)
aws iam put-user-policy \
    --user-name nexus-app-dev \
    --policy-name nexus-sqs-access-dev \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": "sqs:SendMessage",
            "Resource": "arn:aws:sqs:us-east-1:<ACCOUNT_ID>:nexus-jobs-dev"
        }]
    }'
```

### 5. Lambda Function

```bash
# Build and zip (see "Deploy Updated Worker Code" above)
aws lambda create-function \
    --function-name nexus-worker \
    --runtime nodejs22.x \
    --handler handler.handler \
    --role arn:aws:iam::<ACCOUNT_ID>:role/nexus-worker-role-dev \
    --zip-file fileb://apps/worker/worker.zip \
    --timeout 30 \
    --memory-size 256 \
    --environment 'Variables={DATABASE_URL=<pooler-url>}' \
    --region us-east-1
```

### 6. SQS Trigger

```bash
aws lambda create-event-source-mapping \
    --function-name nexus-worker \
    --event-source-arn arn:aws:sqs:us-east-1:<ACCOUNT_ID>:nexus-jobs-dev \
    --batch-size 1 \
    --region us-east-1
```

## Cleanup

```bash
# Remove event source mapping
UUID=$(aws lambda list-event-source-mappings \
    --function-name nexus-worker --region us-east-1 \
    --query 'EventSourceMappings[0].UUID' --output text)
aws lambda delete-event-source-mapping --uuid $UUID --region us-east-1

# Delete Lambda
aws lambda delete-function --function-name nexus-worker --region us-east-1

# Delete IAM policies and role
aws iam delete-role-policy --role-name nexus-worker-role-dev --policy-name nexus-worker-sqs-dev
aws iam delete-role-policy --role-name nexus-worker-role-dev --policy-name nexus-worker-s3-dev
aws iam delete-role-policy --role-name nexus-worker-role-dev --policy-name nexus-worker-logs-dev
aws iam delete-role --role-name nexus-worker-role-dev

# Delete SQS queues
aws sqs delete-queue --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/nexus-jobs-dev --region us-east-1
aws sqs delete-queue --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/nexus-jobs-dlq-dev --region us-east-1

# Remove web app SQS permission
aws iam delete-user-policy --user-name nexus-app-dev --policy-name nexus-sqs-access-dev
```

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

> **Note:** The dev Lambda event source mapping is active, so test messages will be consumed by the real worker. Since the test only asserts on the publish side, this doesn't affect test correctness.

## Related

- [[lambda-development|Lambda Development]] — Worker conventions and job handler patterns
- [[../infra/aws-manual-setup|AWS Manual Setup]] — S3 and IAM user setup
- [[../architecture/system-design|System Design]] — High-level architecture
