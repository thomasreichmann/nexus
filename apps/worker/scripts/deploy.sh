#!/usr/bin/env bash
# Build and deploy the worker bundle to nexus-worker-<env>.
#
# Single source of truth for the deploy recipe: post-merge.yml runs this on
# every merge to main (dev, then prod), and humans run it directly for a
# first deploy, rollback, or hotfix. Terraform never ships worker code — it
# creates the function from a stub and ignores the package thereafter
# (infra/terraform/lambda.tf).
#
# Usage:
#   pnpm -F worker deploy:dev   (or deploy:prod)
#
# Named deploy:<env> because a bare `deploy` script is shadowed by pnpm's
# built-in `pnpm deploy` command.
set -euo pipefail

usage() {
    echo "usage: $0 <dev|prod>" >&2
    exit 1
}

[ $# -eq 1 ] || usage
ENV="$1"
case "$ENV" in dev | prod) ;; *) usage ;; esac

REGION="us-east-1"
# One bundle, two functions: zip builds run on their own Lambda for the 15-minute
# timeout (infra/terraform/lambda.tf), but share this code. Both must be updated
# together — a half-deployed pair runs two versions of the same handler registry.
FUNCTIONS=("nexus-worker-$ENV" "nexus-worker-zip-$ENV")

# Run from the package root regardless of caller cwd.
cd "$(dirname "$0")/.."

pnpm build

# zip appends into an existing archive, so start clean. The package.json
# marks the bundle as ESM — Lambda's node22 runtime needs it.
rm -f worker.zip
(cd dist && echo '{"type":"module"}' >package.json && zip -qr ../worker.zip .)

# The update call returns the hash of what S3 accepted; compare against the
# local zip so a truncated upload can't pass silently.
local_sha=$(openssl dgst -sha256 -binary worker.zip | openssl base64)

for FUNCTION in "${FUNCTIONS[@]}"; do
    echo "Deploying worker.zip to $FUNCTION ($REGION)..."
    aws lambda update-function-code \
        --function-name "$FUNCTION" \
        --zip-file fileb://worker.zip \
        --region "$REGION" \
        --no-cli-pager \
        --query '{CodeSha256:CodeSha256,CodeSize:CodeSize,LastModified:LastModified}' \
        --output table

    # Blocks until LastUpdateStatus leaves InProgress; exits non-zero on Failed.
    aws lambda wait function-updated-v2 --function-name "$FUNCTION" --region "$REGION"

    remote_sha=$(aws lambda get-function --function-name "$FUNCTION" --region "$REGION" \
        --query 'Configuration.CodeSha256' --output text)
    if [ "$local_sha" != "$remote_sha" ]; then
        echo "CodeSha256 mismatch on $FUNCTION: local $local_sha vs deployed $remote_sha" >&2
        exit 1
    fi

    echo "Deployed $FUNCTION (CodeSha256 $remote_sha)"
done
