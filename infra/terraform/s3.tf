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

# prevent_destroy above guards the Terraform plane only. Versioning is the
# data-plane guard (#383): a DeleteObject without a version ID — from a code
# bug, a bad script or a leaked key — writes a delete marker instead of
# removing bytes, so the object stays recoverable until the noncurrent-version
# rule below expires it. No principal in this stack holds
# s3:DeleteObjectVersion, so nothing short of an admin can skip that window.
# What that means for callers that delete: docs/guides/storage.md.
#
# Suspending (not removing) is the only way back: a versioned bucket can never
# return to unversioned.
resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id

  versioning_configuration {
    status = "Enabled"
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
  # would make them cost more cold than warm). Nothing in the DB mirrors the
  # result: this rule is the policy `isProbablyCold` derives its guess from,
  # and the real answer is read from S3 with a HEAD (#416).
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

  # The recovery window versioning buys, and its cost ceiling (#383). Thirty
  # days is long enough to notice a bad delete and short enough that deleted
  # bytes stop billing after one month. An object over 128KB that has been
  # through a lifecycle run is already Deep Archive, whose 180-day minimum is
  # billed on deletion anyway, so for one younger than ~150 days the extra 30
  # days costs nothing. Objects deleted within a day or two of upload (abandoned
  # uploads, mostly) are still STANDARD and pay 30 days of Standard storage. The
  # transition rule above covers current versions only, so a noncurrent version
  # keeps the class it had when it was superseded.
  #
  # expired_object_delete_marker removes the marker once the versions behind it
  # have expired. Without it every deleted key leaves a marker behind for good,
  # and ListObjectVersions has to page through all of them.
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  # The provider's documented ordering for a versioned bucket: put the lifecycle
  # configuration only after versioning is enabled, so the noncurrent rule never
  # lands on a bucket that is not versioned yet.
  depends_on = [aws_s3_bucket_versioning.files]
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

# Retrieval artifacts: the zip archives the worker builds when a multi-file
# restore's last file thaws (#424). Keys are
# `${userId}/${requestId}/${artifactId}/nexus-part-N.zip` — see artifactKey() in
# apps/worker/src/handlers/buildRetrievalZip.ts.
#
# A separate bucket rather than a prefix on `files` because the transition rule
# above is filtered only by object size: a staged zip over 128KB would be swept
# into Deep Archive on the next lifecycle run, and S3 lifecycle filters cannot
# express "every object except this prefix". Separate from `derived` too, whose
# contents are permanent while these are disposable.
resource "aws_s3_bucket" "retrieval_artifacts" {
  bucket = "nexus-retrieval-artifacts-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "retrieval_artifacts" {
  bucket = aws_s3_bucket.retrieval_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "retrieval_artifacts" {
  bucket = aws_s3_bucket.retrieval_artifacts.id

  # This rule owns how long a restore stays downloadable — it is the number the
  # user experiences, and the reason the thawed originals behind it only need
  # ZIP_BUILD_RESTORE_DAYS (packages/db/src/objectState.ts). Seven days to match
  # what the direct single-file download has always promised.
  rule {
    id     = "expire-retrieval-artifacts"
    status = "Enabled"
    filter {}

    expiration {
      days = 7
    }
  }

  # One day, not the files bucket's seven: these uploads are machine-paced and
  # finish in minutes, so anything still incomplete the next day is debris from
  # a Lambda that died mid-stream. A 4GB abandoned upload bills for its parts
  # until something reaps them.
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
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
