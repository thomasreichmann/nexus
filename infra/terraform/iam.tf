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
    Statement = [{
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
    }]
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
