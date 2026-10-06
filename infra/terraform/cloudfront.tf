# Restore downloads through CloudFront (#345)
#
# Every byte a user downloads leaves AWS. Straight out of S3 that is $0.09/GB
# with no free tier to speak of (100 GB/month, account-wide). Through
# CloudFront the S3 -> edge leg is free and edge -> user is free for the first
# 1 TB/month (also account-wide, and shared with anything else on this
# account), then ~$0.085/GB. Nothing is cached: each restore is downloaded
# about once, and the copies are private and short-lived. The saving is the
# transfer price, not cache hits.
#
# One distribution per bucket rather than one with two origins. Two origins
# behind one hostname need a path prefix to tell them apart, and a prefix the
# bucket doesn't have needs a viewer-request function to strip it. AWS doesn't
# document whether signed-URL validation runs before or after that rewrite, and
# a rewritten URI is re-encoded on its way to the origin. Single-file keys end
# in the user's original filename, so that re-encoding is exactly where a
# hostile name breaks. With one distribution per bucket the URL path is the raw
# key: no function, no rewrite.
#
# Kept compatible with CloudFront's flat-rate plans, so moving off
# pay-as-you-go is a console change, not a code change. That means OAC (not
# OAI), cache and origin request policies (not legacy ForwardedValues), a
# standard distribution, and no real-time logs. A plan also requires a WAF web
# ACL, which costs money on pay-as-you-go, so none is attached until a plan is.
# Plans are per distribution.

locals {
  download_buckets = {
    files               = aws_s3_bucket.files
    retrieval_artifacts = aws_s3_bucket.retrieval_artifacts
  }
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "nexus-s3-${var.environment}"
  description                       = "Signs CloudFront's reads from the Nexus buckets (#345)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# The private half never touches Terraform, for the same reason the IAM access
# keys don't (iam.tf). It is generated locally and lives only in the app's env.
# See README.md "CloudFront signing key".
#
# A new encoded_key replaces this resource. CloudFront refuses to delete a key
# a key group still lists, so the replacement has to be created and swapped into
# the group before the old one goes: create_before_destroy, and a name_prefix
# so the two can coexist for that moment.
resource "aws_cloudfront_public_key" "downloads" {
  name_prefix = "nexus-downloads-${var.environment}-"
  comment     = "Verifies the app's signed download URLs (#345)"
  encoded_key = var.cloudfront_public_key_pem

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_key_group" "downloads" {
  name    = "nexus-downloads-${var.environment}"
  comment = "Signers trusted on the Nexus download distributions (#345)"
  items   = [aws_cloudfront_public_key.downloads.id]
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards the one query parameter S3 needs for the saved filename. Allowlisted
# rather than "all": the signed URL's own Expires/Signature/Key-Pair-Id
# parameters have no business reaching S3. OAC signs the origin request, which
# is what lets S3 honour a response-* override at all. Range needs no entry:
# CloudFront passes range requests through natively.
resource "aws_cloudfront_origin_request_policy" "downloads" {
  name    = "nexus-downloads-${var.environment}"
  comment = "Forward response-content-disposition to S3 (#345)"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "whitelist"
    query_strings {
      items = ["response-content-disposition"]
    }
  }
}

resource "aws_cloudfront_distribution" "downloads" {
  for_each = local.download_buckets

  enabled         = true
  comment         = "Nexus ${each.key} downloads (${var.environment}, #345)"
  is_ipv6_enabled = true
  http_version    = "http2and3"
  # Every edge, not the cheaper NA/EU-only class: the alpha testers are in
  # Brazil, and a flat-rate plan prices all regions the same anyway.
  price_class = "PriceClass_All"

  origin {
    origin_id                = "s3-${each.key}"
    domain_name              = each.value.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${each.key}"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    # Without a trusted key group CloudFront ignores the signature entirely and
    # serves anyone who has a key. This line is the access control.
    trusted_key_groups       = [aws_cloudfront_key_group.downloads.id]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.downloads.id
    # Archives and media gain nothing from edge compression, and the user should
    # get back the bytes they uploaded.
    compress = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Both buckets carried no policy before #345; the app and worker read through
# IAM grants (iam.tf, lambda.tf), which this leaves untouched. A service
# principal scoped by SourceArn is not "public", so the buckets' public access
# blocks allow it.
resource "aws_s3_bucket_policy" "cloudfront_read" {
  for_each = local.download_buckets

  bucket = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontDownloads"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${each.value.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.downloads[each.key].arn
        }
      }
    }]
  })
}
