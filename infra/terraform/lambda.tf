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
    # thumbnail whose original was cold when it first ran (#416), so the
    # worker publishes to the same queue it consumes.
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:SendMessage",
      ]
      Resource = aws_sqs_queue.jobs.arn
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

# Sizing (1GB/120s) is driven by the generate-thumbnail job — ffmpeg decode
# of a poster frame plus exiftool extraction — and applies function-wide to
# all job types; at our volume the difference is fractions of a cent. A
# future split is mechanical (second function + second queue), NOT SQS
# event-source-mapping filters, which silently delete non-matching messages.
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
    variables = {
      DATABASE_URL = var.database_url
      # AWS_REGION is reserved and set by the Lambda runtime itself.
      S3_BUCKET         = aws_s3_bucket.files.bucket
      S3_DERIVED_BUCKET = aws_s3_bucket.derived.bucket
      SQS_QUEUE_URL     = aws_sqs_queue.jobs.url
    }
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
