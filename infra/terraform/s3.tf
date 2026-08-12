# Files bucket — behavior context: docs/guides/storage.md

resource "aws_s3_bucket" "files" {
  bucket = "nexus-storage-files-${var.environment}"

  # Customer archives live here and cannot be rebuilt from this config. The
  # guard also fails a whole-stack destroy at plan time, before anything else
  # in the stack is torn down.
  lifecycle {
    prevent_destroy = true
  }
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

  # Objects transition to Glacier Deep Archive when the (~daily) lifecycle
  # run picks them up — in practice ~24-48h after upload, not literally day 0.
  # The size floor makes S3's implicit 128KB transition minimum explicit:
  # sub-128KB objects never transition (Deep Archive's minimum billable size
  # would make them cost more cold than warm), and their rows stay 'standard'
  # (see handleLifecycleTransition in apps/web/server/services/s3-restore.ts).
  rule {
    id     = "glacier-deep-archive-immediate"
    status = "Enabled"
    filter {
      object_size_greater_than = 131072
    }

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

# Derived bucket: worker-generated thumbnails (#350). Standard class with no
# transition lifecycle by design — "thumbnails stay warm" is a product
# decision, not a side effect of the 128KB transition minimum (a 1080p video
# poster can cross 128KB and would otherwise archive out from under the UI).
# Keys are `${userId}/${fileId}/thumb.webp` — see thumbnailKey() in
# packages/db/src/repositories/files.ts. No CORS: thumbnails load via
# presigned GETs in <img> tags, which aren't CORS-restricted.
resource "aws_s3_bucket" "derived" {
  bucket = "nexus-derived-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "derived" {
  bucket = aws_s3_bucket.derived.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
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
