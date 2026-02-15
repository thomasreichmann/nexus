# AWS Manual Setup (Dev Environment)

This documents the manual AWS setup for the dev environment. Created 2026-01-23.

## Resources Created

| Resource   | Name/ARN                                |
| ---------- | --------------------------------------- |
| S3 Bucket  | `nexus-storage-files-dev`               |
| IAM User   | `nexus-app-dev`                         |
| IAM Policy | `nexus-s3-access-dev` (inline on user)  |
| IAM Policy | `nexus-sqs-access-dev` (inline on user) |
| Region     | `us-east-1`                             |

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
