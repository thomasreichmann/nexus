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
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.jobs.arn
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
