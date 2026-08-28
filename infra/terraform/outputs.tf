# Env var mapping — prod values go to the Vercel Production tier (#291), dev
# values to Preview + Development and the GitHub Actions secrets (#127):
#   S3_BUCKET         <- s3_bucket
#   S3_DERIVED_BUCKET <- s3_derived_bucket
#   AWS_REGION        <- aws_region
#   SQS_QUEUE_URL     <- sqs_queue_url
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY <- manual access key on app_iam_user
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

output "aws_region" {
  description = "Region all resources live in -> Vercel AWS_REGION"
  value       = var.region
}

output "sqs_queue_url" {
  description = "Jobs queue URL -> Vercel SQS_QUEUE_URL"
  value       = aws_sqs_queue.jobs.url
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
