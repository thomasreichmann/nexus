---
title: AWS Manual Setup
created: 2026-01-23
updated: 2026-02-15
status: active
tags:
    - infra
    - aws
aliases:
    - AWS Manual Setup
ai_summary: 'Manual AWS provisioning commands for S3, IAM, and SNS resources in dev'
---

# AWS Manual Setup (Dev Environment)

This documents the manual AWS setup for the dev environment. Created 2026-01-23.

## Resources Created

| Resource         | Name/ARN                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| S3 Bucket        | `nexus-storage-files-dev`                                                                                |
| IAM User         | `nexus-app-dev`                                                                                          |
| IAM Policy       | `nexus-s3-access-dev` (inline on user)                                                                   |
| IAM Policy       | `nexus-sqs-access-dev` (inline on user)                                                                  |
| SNS Topic        | `nexus-s3-restore-events-dev` — `arn:aws:sns:us-east-1:391615358272:nexus-s3-restore-events-dev`         |
| SNS DLQ          | `nexus-s3-restore-events-dlq-dev` — `arn:aws:sqs:us-east-1:391615358272:nexus-s3-restore-events-dlq-dev` |
| SNS Subscription | HTTPS → `https://{domain}/api/webhooks/s3-restore` (raw message delivery)                                |
| Region           | `us-east-1`                                                                                              |

> **Background Jobs:** SQS, Lambda, and related IAM resources are documented in [[../guides/background-jobs|Background Jobs Runbook]].

## S3 Bucket Configuration

### Public Access Block

All public access is blocked:

```json
{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
}
```

### Lifecycle Rules

1. **glacier-deep-archive-immediate**: Transitions all objects to Glacier Deep Archive immediately (Day 0)
2. **abort-incomplete-multipart**: Aborts incomplete multipart uploads after 7 days

### CORS Configuration

Allows requests from:

- `http://localhost:*`
- `http://127.0.0.1:*`
- `https://*.vercel.app`

Methods: GET, PUT, POST, DELETE, HEAD

## IAM Policy

The `nexus-app-dev` user has the following permissions on the bucket:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:RestoreObject",
                "s3:GetObjectAttributes"
            ],
            "Resource": [
                "arn:aws:s3:::nexus-storage-files-dev",
                "arn:aws:s3:::nexus-storage-files-dev/*"
            ]
        }
    ]
}
```

## Environment Variables

Add these to Vercel (Development environment):

| Variable                | Value                     |
| ----------------------- | ------------------------- |
| `AWS_ACCESS_KEY_ID`     | (stored in Vercel)        |
| `AWS_SECRET_ACCESS_KEY` | (stored in Vercel)        |
| `AWS_S3_BUCKET`         | `nexus-storage-files-dev` |
| `AWS_REGION`            | `us-east-1`               |

## SNS Topic for S3 Restore Events

Receives S3 Glacier restore lifecycle events (`s3:ObjectRestore:Post`, `s3:ObjectRestore:Completed`, `s3:ObjectRestore:Delete`) and delivers them to the webhook endpoint via HTTPS subscription.

See [[../guides/webhooks|Webhook Handling]] for the webhook pattern and signature verification.

### Provisioning Commands

Set these variables before running the commands below. Replace `<ACCOUNT_ID>` with your AWS account ID when provisioning a new environment.

```bash
ACCOUNT_ID="391615358272"
REGION="us-east-1"
BUCKET="nexus-storage-files-dev"
TOPIC_NAME="nexus-s3-restore-events-dev"
DLQ_NAME="nexus-s3-restore-events-dlq-dev"
TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT_ID}:${TOPIC_NAME}"
DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${DLQ_NAME}"
DLQ_URL="https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/${DLQ_NAME}"
```

#### 1. Dead Letter Queue (for failed webhook deliveries)

```bash
aws sqs create-queue \
    --queue-name "$DLQ_NAME" \
    --region "$REGION"
```

#### 2. SNS Topic

```bash
aws sns create-topic \
    --name "$TOPIC_NAME" \
    --region "$REGION"
```

#### 3. SNS Topic Policy (allow S3 to publish)

```bash
aws sns set-topic-attributes \
    --topic-arn "$TOPIC_ARN" \
    --attribute-name Policy \
    --attribute-value '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "s3.amazonaws.com"},
            "Action": "SNS:Publish",
            "Resource": "'"$TOPIC_ARN"'",
            "Condition": {
                "ArnLike": {
                    "aws:SourceArn": "arn:aws:s3:::'"$BUCKET"'"
                }
            }
        }]
    }'
```

#### 4. DLQ Policy (allow SNS to send failed messages)

```bash
DLQ_POLICY=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "sns.amazonaws.com"},
        "Action": "sqs:SendMessage",
        "Resource": "$DLQ_ARN",
        "Condition": {
            "ArnEquals": {
                "aws:SourceArn": "$TOPIC_ARN"
            }
        }
    }]
}
EOF
)

aws sqs set-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attributes "{\"Policy\": $(echo "$DLQ_POLICY" | jq -cj | jq -Rs)}"
```

> **Requires `jq`** for proper JSON escaping. Install with `brew install jq` if needed.

#### 5. HTTPS Subscription

```bash
aws sns subscribe \
    --topic-arn "$TOPIC_ARN" \
    --protocol https \
    --notification-endpoint "https://{domain}/api/webhooks/s3-restore" \
    --attributes "{
        \"RawMessageDelivery\": \"true\",
        \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\"}\"
    }" \
    --region "$REGION"
```

> **Note:** The endpoint must be deployed and respond to the SNS `SubscriptionConfirmation` request before the subscription becomes active. Replace `{domain}` with the actual Vercel deployment URL.

#### 6. S3 Event Notifications

```bash
aws s3api put-bucket-notification-configuration \
    --bucket "$BUCKET" \
    --notification-configuration '{
        "TopicConfigurations": [{
            "TopicArn": "'"$TOPIC_ARN"'",
            "Events": [
                "s3:ObjectRestore:Post",
                "s3:ObjectRestore:Completed",
                "s3:ObjectRestore:Delete"
            ]
        }]
    }'
```

> **Warning:** `put-bucket-notification-configuration` replaces the entire notification config. If the bucket already has other notifications configured, include them in the same command. Check existing config first with `aws s3api get-bucket-notification-configuration --bucket "$BUCKET"`.

### SNS Verification Commands

```bash
# Check topic exists and view attributes
aws sns get-topic-attributes \
    --topic-arn "$TOPIC_ARN" \
    --region "$REGION"

# List subscriptions on the topic
aws sns list-subscriptions-by-topic \
    --topic-arn "$TOPIC_ARN" \
    --region "$REGION"

# Check S3 event notification config
aws s3api get-bucket-notification-configuration \
    --bucket "$BUCKET"

# Check DLQ depth (should be 0 normally)
aws sqs get-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --region "$REGION"

# Publish a test message to SNS (verifies topic + subscription)
aws sns publish \
    --topic-arn "$TOPIC_ARN" \
    --message '{"test": true}' \
    --region "$REGION"
```

### SNS Cleanup

```bash
# Delete subscription (get ARN from list-subscriptions-by-topic)
aws sns unsubscribe \
    --subscription-arn <SUBSCRIPTION_ARN> \
    --region "$REGION"

# Remove S3 event notifications (set empty config)
aws s3api put-bucket-notification-configuration \
    --bucket "$BUCKET" \
    --notification-configuration '{}'

# Delete SNS topic
aws sns delete-topic \
    --topic-arn "$TOPIC_ARN" \
    --region "$REGION"

# Delete DLQ
aws sqs delete-queue \
    --queue-url "$DLQ_URL" \
    --region "$REGION"
```

## Verification Commands

```bash
# List bucket contents
aws s3 ls s3://nexus-storage-files-dev

# Check lifecycle rules
aws s3api get-bucket-lifecycle-configuration --bucket nexus-storage-files-dev

# Check CORS
aws s3api get-bucket-cors --bucket nexus-storage-files-dev

# Check public access block
aws s3api get-public-access-block --bucket nexus-storage-files-dev
```

## Cleanup (if needed)

```bash
# Delete all objects first (required before bucket deletion)
aws s3 rm s3://nexus-storage-files-dev --recursive

# Delete bucket
aws s3api delete-bucket --bucket nexus-storage-files-dev --region us-east-1

# Delete IAM user (must remove policy and keys first)
aws iam delete-user-policy --user-name nexus-app-dev --policy-name nexus-s3-access-dev
aws iam list-access-keys --user-name nexus-app-dev  # Get key IDs
aws iam delete-access-key --user-name nexus-app-dev --access-key-id <KEY_ID>
aws iam delete-user --user-name nexus-app-dev
```
