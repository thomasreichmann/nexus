# Nexus Terraform

Provisions one full Nexus AWS environment (S3 files bucket, SNS restore-events
topic + webhook subscription, SQS jobs queues, worker Lambda, app IAM user),
parameterized by `environment` and `region`. **Both environments are managed
here and this is the source of truth**: prod since #53, dev since #127 (the
hand-built dev resources were decommissioned and recreated from these files,
which closed the main drift vector between environments).

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

## Apply

```bash
cd infra/terraform
terraform init
terraform workspace select prod || terraform workspace new prod   # or dev

# The worker Lambda's DATABASE_URL — this environment's Supabase
# transaction-pooler URL (port 6543, see docs/infra/supabase-manual-setup.md).
# Never commit it. It is also stored (encrypted at rest) in the Terraform
# state bucket.
set -x TF_VAR_database_url "postgresql://..."   # fish; bash: export TF_VAR_database_url=...

terraform plan -var-file=environments/prod.tfvars    # or dev.tfvars
terraform apply -var-file=environments/prod.tfvars   # or dev.tfvars
```

The SNS subscription only confirms if the app is already deployed and serving
`https://<app_domain>/api/webhooks/s3-restore` — the route auto-confirms by
fetching `SubscribeURL`, and Terraform waits for that. For dev, `app_domain`
is `dev.nexus.thomasar.dev` (a Cloudflare CNAME → Vercel custom domain pinned
to the long-lived `dev` branch; Preview tier = dev Supabase + dev AWS). It
confirms without a bypass token because Vercel Authentication is disabled on the
nexus-web project — a custom domain on a preview branch is NOT auto-exempt (only
the production domain is), and the Hobby plan offers no per-domain exception, so
#317 turned deployment protection off project-wide. The post-merge workflow
fast-forwards `dev` to `main` on every merge so that deployment tracks
production code.

## After apply

1. **App access key** (kept out of Terraform state on purpose):

    ```bash
    aws iam create-access-key --user-name nexus-app-<env>
    ```

2. **Worker code** — Terraform ships a stub that throws on every invocation
   (so jobs retry into the DLQ instead of silently succeeding). Deploy the
   real worker per `docs/guides/background-jobs.md`, with
   `--function-name nexus-worker-<env> --region us-east-1`. Later applies
   won't touch the deployed code (`ignore_changes` on the package), but the
   Lambda's environment (`DATABASE_URL`) **is** Terraform-managed — update it
   here, not with `aws lambda update-function-configuration`.

3. **Env vars** from `terraform output` — prod values go to the Vercel
   Production tier (#291), dev values to Preview + Development (and GitHub
   Actions secrets `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET`/
   `SQS_QUEUE_URL`, which are dev-scoped):

    | Var                                           | Source                 |
    | --------------------------------------------- | ---------------------- |
    | `S3_BUCKET`                                   | `s3_bucket` output     |
    | `AWS_REGION`                                  | `aws_region` output    |
    | `SQS_QUEUE_URL`                               | `sqs_queue_url` output |
    | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | access key from step 1 |
