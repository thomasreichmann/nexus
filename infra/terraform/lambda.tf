# Worker Lambda + execution role — spec: docs/guides/background-jobs.md

resource "aws_iam_role" "worker" {
  name = "nexus-worker-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "worker_sqs" {
  name = "nexus-worker-sqs-${var.environment}"
  role = aws_iam_role.worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    # SendMessage as well as receive: the retrieval poll re-enqueues a
    # thumbnail whose original was cold when it first ran (#416) and publishes
    # a zip build per chunk when a request's last file thaws (#424), so the
    # worker publishes to both queues and consumes both.
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:SendMessage",
      ]
      Resource = [aws_sqs_queue.jobs.arn, aws_sqs_queue.zip_jobs.arn]
    }]
  })
}

resource "aws_iam_role_policy" "worker_s3" {
  name = "nexus-worker-s3-${var.environment}"
  role = aws_iam_role.worker.id

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
        ]
        Resource = [aws_s3_bucket.files.arn, "${aws_s3_bucket.files.arn}/*"]
      },
      {
        # Thumbnail writes (generate-thumbnail job) + reads for idempotent
        # regeneration checks.
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.derived.arn}/*"
      },
      {
        # Zip artifacts (#424). PutObject covers the whole multipart write
        # (CreateMultipartUpload / UploadPart / CompleteMultipartUpload);
        # AbortMultipartUpload is what lets a failed build clean up its own
        # parts instead of leaving them to the bucket's 1-day abort rule.
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ]
        Resource = "${aws_s3_bucket.retrieval_artifacts.arn}/*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "worker_logs" {
  name = "nexus-worker-logs-${var.environment}"
  role = aws_iam_role.worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:*"
    }]
  })
}

# Placeholder package so Terraform can create the function. Real worker code
# deploys via post-merge.yml → apps/worker/scripts/deploy.sh on every merge
# (docs/guides/background-jobs.md); ignore_changes below keeps Terraform from
# clobbering it on later applies.
data "archive_file" "worker_stub" {
  type        = "zip"
  output_path = "${path.module}/worker-stub.zip"

  source {
    filename = "handler.js"
    content  = <<-EOT
      export const handler = async () => {
        throw new Error('nexus-worker stub: deploy the real worker code (docs/guides/background-jobs.md)');
      };
    EOT
  }

  source {
    filename = "package.json"
    content  = jsonencode({ type = "module" })
  }
}

# Both worker functions run the same bundle and therefore need the same
# environment; which one picks a job up is decided by the queue it was
# published to (queueUrlFor in apps/worker/src/jobs.ts), not by configuration.
locals {
  worker_environment = {
    DATABASE_URL = var.database_url
    # AWS_REGION is reserved and set by the Lambda runtime itself.
    S3_BUCKET         = aws_s3_bucket.files.bucket
    S3_DERIVED_BUCKET = aws_s3_bucket.derived.bucket
    SQS_QUEUE_URL     = aws_sqs_queue.jobs.url

    # Zip build pipeline (#424).
    S3_RETRIEVAL_ARTIFACTS_BUCKET = aws_s3_bucket.retrieval_artifacts.bucket
    SQS_ZIP_QUEUE_URL             = aws_sqs_queue.zip_jobs.url

    # Notification plumbing (#425). The worker owns retrieval completion
    # since #416 moved it off the SNS webhook, so it owns the "your restore
    # is ready" email too. APP_URL is the link target: the email points at
    # the app (sign in -> file focused -> Download), never a presigned S3
    # URL, which expires in an hour while the restore stays downloadable for
    # days. Same host the ops-alerts subscription uses.
    APP_URL           = "https://${var.app_domain}"
    RESEND_API_KEY    = var.resend_api_key
    RESEND_FROM_EMAIL = var.resend_from_email

    # Server-side analytics is opt-in per runtime. The app used to gate on
    # `process.env.VERCEL`, which Lambda never sets — so this flag is what
    # lets the worker report at all. An empty posthog_key still disables it:
    # @nexus/analytics never constructs a client without a key.
    ANALYTICS_ENABLED = "true"
    POSTHOG_KEY       = var.posthog_key
    # The vocabulary the app reports (VERCEL_ENV), not Terraform's dev/prod
    # names: PostHog's "filter out internal and test users" toggle is
    # configured against this property, so a value it doesn't recognise
    # would quietly leak dev traffic into production insights.
    ANALYTICS_ENVIRONMENT = var.environment == "prod" ? "production" : "development"
  }
}

# Sizing (1GB/120s) is driven by the generate-thumbnail job — ffmpeg decode
# of a poster frame plus exiftool extraction — and applies function-wide to
# all job types; at our volume the difference is fractions of a cent. Zip
# builds are the one job that could not live inside it and took the documented
# escape hatch below.
resource "aws_lambda_function" "worker" {
  function_name = "nexus-worker-${var.environment}"
  role          = aws_iam_role.worker.arn
  runtime       = "nodejs22.x"
  handler       = "handler.handler"
  timeout       = 120
  memory_size   = 1024

  filename         = data.archive_file.worker_stub.output_path
  source_code_hash = data.archive_file.worker_stub.output_base64sha256

  # ffmpeg + perl/exiftool binaries mount under /opt (see layers.tf).
  layers = [
    aws_lambda_layer_version.ffmpeg.arn,
    aws_lambda_layer_version.exiftool.arn,
  ]

  environment {
    variables = local.worker_environment
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_event_source_mapping" "worker_jobs" {
  function_name    = aws_lambda_function.worker.arn
  event_source_arn = aws_sqs_queue.jobs.arn
  batch_size       = 1
}

# The split the comment above pre-authorised (#424): a second function and a
# second queue, never an SQS event-source-mapping filter, which silently
# deletes non-matching messages.
#
# 900s is Lambda's maximum and the reason for the split — a 4GB chunk streams
# through in well under two minutes, so the budget is retry headroom for a slow
# S3 day, not an expected runtime. 2GB of memory is bought for network
# bandwidth and CRC32 throughput rather than for footprint: the build holds one
# 8MB multipart part and one S3 response at a time (see multipartUpload.ts), so
# it would fit in the general worker's 1GB and simply run slower.
#
# No ffmpeg/exiftool layers: nothing here shells out.
resource "aws_lambda_function" "zip_worker" {
  function_name = "nexus-worker-zip-${var.environment}"
  role          = aws_iam_role.worker.arn
  runtime       = "nodejs22.x"
  handler       = "handler.handler"
  timeout       = 900
  memory_size   = 2048

  # Bounds the fan-out of a large restore. Each concurrent build holds a
  # database connection for up to 15 minutes, and unbounded concurrency against
  # the pooler is the shape of the incident #416 was written about; it also
  # keeps a full-archive restore from saturating our own S3 read bandwidth.
  # Chunks that do not fit simply wait in the queue.
  reserved_concurrent_executions = 5

  filename         = data.archive_file.worker_stub.output_path
  source_code_hash = data.archive_file.worker_stub.output_base64sha256

  environment {
    variables = local.worker_environment
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_event_source_mapping" "zip_worker_jobs" {
  function_name    = aws_lambda_function.zip_worker.arn
  event_source_arn = aws_sqs_queue.zip_jobs.arn
  batch_size       = 1
}
