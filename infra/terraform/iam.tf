# Web-app IAM user
#
# Access keys are created manually (`aws iam create-access-key`) so the secret
# never lands in Terraform state. See README.md.

resource "aws_iam_user" "app" {
  name = "nexus-app-${var.environment}"
}

resource "aws_iam_user_policy" "app_s3" {
  name = "nexus-s3-access-${var.environment}"
  user = aws_iam_user.app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:RestoreObject",
          "s3:GetObjectAttributes",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
          # Bucket-level, unlike the two above: `reap:stale-uploads` calls
          # ListMultipartUploads across the whole bucket to tell a stranded
          # single-part row from a multipart session still open (see the note
          # in reap-stale-uploads.ts). Without it the reaper 403s before it
          # touches anything, so the remedy for the nightly stale-upload leg
          # of check:s3-event-health never ran.
          "s3:ListBucketMultipartUploads",
        ]
        Resource = [aws_s3_bucket.files.arn, "${aws_s3_bucket.files.arn}/*"]
      },
      {
        # Read-only: the web app only presigns GETs for thumbnails; the
        # worker is the sole writer to the derived bucket.
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.derived.arn}/*"
      },
    ]
  })
}

resource "aws_iam_user_policy" "app_sqs" {
  name = "nexus-sqs-access-${var.environment}"
  user = aws_iam_user.app.name

  policy = jsonencode({
    Version = "2012-10-17"
    # Both queues: the admin retry re-publishes a failed job on whichever queue
    # its type belongs to (queueFor in packages/db/src/jobs/types.ts), which
    # includes zip builds.
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = [aws_sqs_queue.jobs.arn, aws_sqs_queue.zip_jobs.arn]
    }]
  })
}

# Nightly-CI IAM user (#318)
#
# Exists so the s3-event-health workflow never needs the app user's key: that
# would hand a scheduled job PutObject/DeleteObject/RestoreObject on production
# data to answer a read-only question.
#
# Both workspaces get one to keep the module set identical across environments
# (#127). Only prod's key is wired into GitHub Actions — the dev leg shares the
# flat AWS_* secrets with workflows that do need to write.
resource "aws_iam_user" "ci" {
  name = "nexus-ci-${var.environment}"
}

# Worker-deploy IAM user (#417 follow-up)
#
# post-merge.yml ships the worker bundle on every merge (apps/worker/scripts/
# deploy.sh) so the Lambda code plane moves with the schema plane instead of
# waiting on a human. Scoped to exactly that: update + read the worker
# function's code. Access keys are created manually, like the app user's
# (README.md), and land in GitHub Actions secrets
# DEPLOY_AWS_ACCESS_KEY_ID[_PROD] / DEPLOY_AWS_SECRET_ACCESS_KEY[_PROD].
resource "aws_iam_user" "deploy" {
  name = "nexus-deploy-${var.environment}"
}

resource "aws_iam_user_policy" "deploy_worker_code" {
  name = "nexus-deploy-worker-code-${var.environment}"
  user = aws_iam_user.deploy.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "lambda:UpdateFunctionCode",
        # get-function backs both the post-update waiter and the CodeSha256
        # verification in deploy.sh.
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
      ]
      # Both functions: deploy.sh ships the same bundle to the general worker
      # and the zip worker (#424).
      Resource = [
        aws_lambda_function.worker.arn,
        aws_lambda_function.zip_worker.arn,
      ]
    }]
  })
}

resource "aws_iam_user_policy" "ci_s3_read" {
  name = "nexus-ci-s3-read-${var.environment}"
  user = aws_iam_user.ci.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      # ListBucket alone: ListObjectsV2 reports each object's StorageClass, so
      # the drift check never reads object bodies or metadata.
      Effect   = "Allow"
      Action   = "s3:ListBucket"
      Resource = aws_s3_bucket.files.arn
    }]
  })
}
