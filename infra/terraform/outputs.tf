# Env var mapping — prod values go to the Vercel Production tier (#291), dev
# values to Preview + Development and the GitHub Actions secrets (#127):
#   S3_BUCKET         <- s3_bucket
#   S3_DERIVED_BUCKET <- s3_derived_bucket
#   AWS_REGION        <- aws_region
#   SQS_QUEUE_URL     <- sqs_queue_url
#   SQS_ZIP_QUEUE_URL <- sqs_zip_queue_url
#   SNS_OPS_ALERTS_TOPIC_ARN <- sns_ops_alerts_topic_arn
#   SQS_INTEGRATION_TEST_QUEUE_URL <- sqs_integration_test_queue_url (dev only;
#     local .env.local and CI for the integration tier, never Vercel)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY <- manual access key on app_iam_user
#   CLOUDFRONT_FILES_DOMAIN     <- cloudfront_files_domain
#   CLOUDFRONT_ARTIFACTS_DOMAIN <- cloudfront_artifacts_domain
#   CLOUDFRONT_KEY_PAIR_ID      <- cloudfront_key_pair_id
#   CLOUDFRONT_PRIVATE_KEY      <- the locally generated private key (README.md)
#
# GitHub Actions additionally holds a read-only key on ci_iam_user as
# AWS_ACCESS_KEY_ID_PROD / AWS_SECRET_ACCESS_KEY_PROD (#318).

output "s3_bucket" {
  description = "Files bucket name -> Vercel S3_BUCKET"
  value       = aws_s3_bucket.files.bucket
}

output "s3_derived_bucket" {
  description = "Derived (thumbnails) bucket name -> Vercel S3_DERIVED_BUCKET"
  value       = aws_s3_bucket.derived.bucket
}

output "cloudfront_files_domain" {
  description = "Download distribution in front of the files bucket (#345) -> Vercel CLOUDFRONT_FILES_DOMAIN"
  value       = aws_cloudfront_distribution.downloads["files"].domain_name
}

output "cloudfront_artifacts_domain" {
  description = "Download distribution in front of the retrieval-artifacts bucket (#345) -> Vercel CLOUDFRONT_ARTIFACTS_DOMAIN"
  value       = aws_cloudfront_distribution.downloads["retrieval_artifacts"].domain_name
}

output "cloudfront_key_pair_id" {
  description = "ID of the public key the download distributions trust (#345) -> Vercel CLOUDFRONT_KEY_PAIR_ID"
  value       = aws_cloudfront_public_key.downloads.id
}

output "aws_region" {
  description = "Region all resources live in -> Vercel AWS_REGION"
  value       = var.region
}

output "sqs_queue_url" {
  description = "Jobs queue URL -> Vercel SQS_QUEUE_URL"
  value       = aws_sqs_queue.jobs.url
}

output "sqs_zip_queue_url" {
  description = "Zip-build queue URL -> Vercel SQS_ZIP_QUEUE_URL"
  value       = aws_sqs_queue.zip_jobs.url
}

output "sqs_integration_test_queue_url" {
  description = "Dev only, null in prod: consumer-less queue for publish.integration.test.ts (#442) -> SQS_INTEGRATION_TEST_QUEUE_URL in apps/web/.env.local and CI"
  value       = one(aws_sqs_queue.integration_test[*].url)
}

output "sns_ops_alerts_topic_arn" {
  description = "Only topic /api/webhooks/cloudwatch-alarm accepts (#319); unset on a deployed tier rejects every alarm -> Vercel SNS_OPS_ALERTS_TOPIC_ARN"
  value       = aws_sns_topic.ops_alerts.arn
}

output "app_iam_user" {
  description = "Web-app IAM user; create its access key manually -> Vercel AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY"
  value       = aws_iam_user.app.name
}

output "ci_iam_user" {
  description = "Read-only nightly-CI user (#318); create its access key manually -> GitHub Actions AWS_ACCESS_KEY_ID_PROD / AWS_SECRET_ACCESS_KEY_PROD"
  value       = aws_iam_user.ci.name
}

output "jobs_dlq_url" {
  description = "DLQ for failed background jobs"
  value       = aws_sqs_queue.jobs_dlq.url
}

output "lambda_function_name" {
  description = "Worker Lambda (deploy code via `aws lambda update-function-code`)"
  value       = aws_lambda_function.worker.function_name
}
