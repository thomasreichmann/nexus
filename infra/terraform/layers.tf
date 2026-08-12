# Lambda layers for the worker: static ffmpeg/ffprobe and relocatable
# perl + vendored exiftool. Built reproducibly in CI from pinned upstream
# sources (.github/workflows/lambda-layers.yml), never third-party layer
# ARNs. The zips are too big for direct Lambda upload, so they flow through
# the artifacts bucket: CI builds -> operator syncs with
# infra/terraform/scripts/upload-layers.sh -> terraform apply publishes.
#
# The s3 keys below embed the pinned tool versions; bump them here AND in
# the workflow together (the apply fails fast if the object is missing).

locals {
  ffmpeg_layer_s3_key   = "layers/ffmpeg-${local.ffmpeg_version}-webp-r${local.ffmpeg_layer_revision}.zip"
  exiftool_layer_s3_key = "layers/exiftool-${local.exiftool_version}-perl-${local.perl_version}-r${local.exiftool_layer_revision}.zip"

  # Keep in lockstep with the pins in tooling/lambda-layers/*.sh. The
  # revision bumps when layer content changes without a tool-version bump
  # (a new s3 key is what makes this module publish a new layer version).
  ffmpeg_version          = "7.1"
  ffmpeg_layer_revision   = 1
  perl_version            = "5.40.0"
  exiftool_version        = "13.55"
  exiftool_layer_revision = 2
}

resource "aws_s3_bucket" "lambda_artifacts" {
  bucket = "nexus-lambda-artifacts-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_lambda_layer_version" "ffmpeg" {
  layer_name               = "nexus-ffmpeg-${var.environment}"
  description              = "Static ffmpeg + ffprobe ${local.ffmpeg_version} with libwebp (built by lambda-layers.yml)"
  s3_bucket                = aws_s3_bucket.lambda_artifacts.bucket
  s3_key                   = local.ffmpeg_layer_s3_key
  compatible_runtimes      = ["nodejs22.x"]
  compatible_architectures = ["x86_64"]
}

resource "aws_lambda_layer_version" "exiftool" {
  layer_name               = "nexus-exiftool-${var.environment}"
  description              = "Relocatable perl ${local.perl_version} + exiftool ${local.exiftool_version} (built by lambda-layers.yml)"
  s3_bucket                = aws_s3_bucket.lambda_artifacts.bucket
  s3_key                   = local.exiftool_layer_s3_key
  compatible_runtimes      = ["nodejs22.x"]
  compatible_architectures = ["x86_64"]
}
