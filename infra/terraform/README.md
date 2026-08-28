# Nexus Terraform

Provisions one full Nexus AWS environment (S3 files bucket, SQS jobs queues,
worker Lambda, the EventBridge retrieval-poll schedule, app IAM user,
ops-alerts topic + webhook subscription + DLQ-depth alarms), parameterized by
`environment` and `region`. **Both environments are managed here and this is the source of
truth**: prod since #53, dev since #127 (the hand-built dev resources were
decommissioned and recreated from these files, which closed the main drift
vector between environments).

Two resources carry a `count` guard so they exist in the prod workspace only:
the monthly cost budget (`budgets.tf`), which is account-global and would
otherwise be fought over by both workspaces, and the alerts email subscription
(`alarms.tf`), which dev deliberately skips.

State lives in S3 (`nexus-terraform-state-391615358272`, us-east-1) with one
workspace per environment. A guard resource fails the plan if the selected
workspace doesn't match `var.environment`, and `prevent_destroy` on the files
bucket fails a whole-stack destroy (see [Destroy](#destroy)).

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

The ops-alerts SNS subscription only confirms if the app is already deployed
and serving `https://<app_domain>/api/webhooks/cloudwatch-alarm` — the route
auto-confirms by fetching `SubscribeURL`, and Terraform waits for that. For dev, `app_domain`
is `dev.nexus.thomasar.dev` (a Cloudflare CNAME → Vercel custom domain pinned
to the long-lived `dev` branch; Preview tier = dev Supabase + dev AWS). It
confirms without a bypass token because Vercel Authentication is disabled on the
nexus-web project — a custom domain on a preview branch is NOT auto-exempt (only
the production domain is), and the Hobby plan offers no per-domain exception, so
#317 turned deployment protection off project-wide. The post-merge workflow
fast-forwards `dev` to `main` on every merge so that deployment tracks
production code.

## After apply

1. **Access keys** (kept out of Terraform state on purpose):

    ```bash
    aws iam create-access-key --user-name nexus-app-<env>
    aws iam create-access-key --user-name nexus-deploy-<env>
    ```

    The deploy user's key goes to GitHub Actions secrets so `post-merge.yml`
    can ship worker code: `DEPLOY_AWS_ACCESS_KEY_ID` /
    `DEPLOY_AWS_SECRET_ACCESS_KEY` for dev, the `_PROD`-suffixed pair for
    prod (`gh secret set <name>`).

2. **Worker code** — Terraform ships a stub that throws on every invocation
   (so jobs retry into the DLQ instead of silently succeeding). The real
   worker deploys automatically on every merge to main (`post-merge.yml`,
   once the deploy secrets from step 1 exist); for a first deploy before any
   merge, run `pnpm -F worker deploy:<env>` yourself. Later applies won't
   touch the deployed code (`ignore_changes` on the package), but the
   Lambda's environment (`DATABASE_URL`, `S3_BUCKET`, `S3_DERIVED_BUCKET`)
   **is** Terraform-managed — update it here, not with
   `aws lambda update-function-configuration`.

3. **Lambda layers** — `layers.tf` publishes the worker's ffmpeg and
   perl/exiftool layers from zips in the `nexus-lambda-artifacts-<env>`
   bucket. Before the first apply (and after any version bump), build them
   in CI (`lambda-layers.yml`) and sync:

    ```bash
    gh run download -n ffmpeg-layer -n exiftool-layer -D /tmp/layers
    ./scripts/upload-layers.sh <env> /tmp/layers
    ```

4. **Env vars** from `terraform output` — prod values go to the Vercel
   Production tier (#291), dev values to Preview + Development (and GitHub
   Actions secrets `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET`/
   `SQS_QUEUE_URL`, which are dev-scoped):

    | Var                                           | Source                     |
    | --------------------------------------------- | -------------------------- |
    | `S3_BUCKET`                                   | `s3_bucket` output         |
    | `S3_DERIVED_BUCKET`                           | `s3_derived_bucket` output |
    | `AWS_REGION`                                  | `aws_region` output        |
    | `SQS_QUEUE_URL`                               | `sqs_queue_url` output     |
    | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | access key from step 1     |

5. **Confirm the alerts email** (prod only) — the apply creates an email
   subscription on `nexus-ops-alerts-prod` and reports success, but AWS leaves
   it in `PendingConfirmation` until someone clicks the link in the "AWS
   Notification - Subscription Confirmation" mail sent to `alert_email`. Until
   then, alarms reach Discord only. Terraform does not diff on confirmation
   status, so nothing later will remind you. Verify:

    ```bash
    aws sns list-subscriptions-by-topic --region us-east-1 \
        --topic-arn arn:aws:sns:us-east-1:391615358272:nexus-ops-alerts-prod \
        --query 'Subscriptions[?Protocol==`email`].SubscriptionArn'
    ```

    A confirmed subscription returns a real ARN; an unconfirmed one returns the
    literal `"PendingConfirmation"`.

    Budget notifications (`budgets.tf`) go to the same address directly, not
    through SNS, so they need no confirmation step.

## Destroy

`aws_s3_bucket.files` carries `lifecycle { prevent_destroy = true }`, so
`terraform destroy` on this stack fails at plan time, before any resource is
removed. That one guard covers everything: the rest of the stack (SQS, SNS,
Lambda, EventBridge, IAM) is reconstructible from these files, so losing it is
an outage, not data loss.

Because of that guard, removing resources here is a targeted **apply** after
deleting them from the config — never a `terraform destroy`.

Decommissioning an environment for real means deleting the bucket contents and
removing the guard in a commit first. Then:

```bash
terraform -chdir=infra/terraform workspace select dev    # or prod
terraform -chdir=infra/terraform destroy -var-file=environments/dev.tfvars
```

- **`-chdir` over `cd`** — the target stack is named in the command itself, so
  a destroy can't hit a different stack because the shell was left in another
  directory.
- **Never `-auto-approve`.** Read the `N to destroy` count in the plan header,
  check that N and the listed resources match the stack you meant, then type
  `yes`.
