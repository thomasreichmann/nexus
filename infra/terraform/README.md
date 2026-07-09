# Nexus Terraform

Provisions one full Nexus AWS environment (S3 files bucket, SNS restore-events
topic + webhook subscription, SQS jobs queues, worker Lambda, app IAM user),
parameterized by `environment` and `region`. **Prod is managed here and is the
source of truth** (#53). Dev is still the hand-built setup documented in
`docs/infra/aws-manual-setup.md` and `docs/guides/background-jobs.md` until
#127 recreates it from these same files.

State lives in S3 (`nexus-terraform-state-391615358272`, us-east-1) with one
workspace per environment. A guard resource fails the plan if the selected
workspace doesn't match `var.environment`.

## Prerequisites

- Terraform >= 1.10 (`brew install hashicorp/tap/terraform`)
- AWS credentials for account `391615358272`
- One-time state bucket bootstrap (already done; kept for reference):

```bash
aws s3api create-bucket --bucket nexus-terraform-state-391615358272 --region us-east-1
aws s3api put-bucket-versioning --bucket nexus-terraform-state-391615358272 \
    --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket nexus-terraform-state-391615358272 \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket nexus-terraform-state-391615358272 \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## Apply (prod)

```bash
cd infra/terraform
terraform init
terraform workspace select prod || terraform workspace new prod

# The worker Lambda's DATABASE_URL — the prod Supabase transaction-pooler URL
# (port 6543, see docs/infra/supabase-manual-setup.md). Never commit it.
# It is also stored (encrypted at rest) in the Terraform state bucket.
set -x TF_VAR_database_url "postgresql://..."   # fish; bash: export TF_VAR_database_url=...

terraform plan -var-file=environments/prod.tfvars
terraform apply -var-file=environments/prod.tfvars
```

The SNS subscription only confirms if the app is already deployed and serving
`https://<app_domain>/api/webhooks/s3-restore` — the route auto-confirms by
fetching `SubscribeURL`, and Terraform waits for that.

## After apply

1. **App access key** (kept out of Terraform state on purpose):

    ```bash
    aws iam create-access-key --user-name nexus-app-prod
    ```

2. **Worker code** — Terraform ships a stub that throws on every invocation
   (so jobs retry into the DLQ instead of silently succeeding). Deploy the
   real worker per `docs/guides/background-jobs.md`, with
   `--function-name nexus-worker-prod --region us-east-1`. Later applies
   won't touch the deployed code (`ignore_changes` on the package), but the
   Lambda's environment (`DATABASE_URL`) **is** Terraform-managed — update it
   here, not with `aws lambda update-function-configuration`.

3. **Vercel Production env vars** (#291) from `terraform output`:

    | Vercel var                                    | Source                 |
    | --------------------------------------------- | ---------------------- |
    | `S3_BUCKET`                                   | `s3_bucket` output     |
    | `AWS_REGION`                                  | `aws_region` output    |
    | `SQS_QUEUE_URL`                               | `sqs_queue_url` output |
    | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | access key from step 1 |

## Dev

Dev is not in state yet (#127). The `environment`/`region` variables and the
`dev` workspace exist for that migration; don't apply dev until #127 — the
resource names would collide with the hand-built ones (and the dev Lambda is
named `nexus-worker`, unsuffixed, so it specifically needs a
create-before-destroy plan).
