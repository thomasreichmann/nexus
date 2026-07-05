# Files bucket — spec: docs/infra/aws-manual-setup.md

resource "aws_s3_bucket" "files" {
  bucket = "nexus-storage-files-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket = aws_s3_bucket.files.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id

  # Every object goes straight to Glacier Deep Archive on day 0.
  rule {
    id     = "glacier-deep-archive-immediate"
    status = "Enabled"
    filter {}

    transition {
      days          = 0
      storage_class = "DEEP_ARCHIVE"
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id

  cors_rule {
    allowed_origins = var.cors_allowed_origins
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_headers = ["*"]
    # Multipart uploads: the browser must read each part's ETag from the response.
    expose_headers = ["ETag"]
  }
}

# Restore + lifecycle-transition events -> SNS -> /api/webhooks/s3-restore.
# The topic policy must exist first: S3 validates publish permission on save.
resource "aws_s3_bucket_notification" "files" {
  bucket = aws_s3_bucket.files.id

  topic {
    topic_arn = aws_sns_topic.s3_restore_events.arn
    events = [
      "s3:ObjectRestore:Post",
      "s3:ObjectRestore:Completed",
      "s3:ObjectRestore:Delete",
      "s3:LifecycleTransition",
    ]
  }

  depends_on = [aws_sns_topic_policy.s3_restore_events]
}
