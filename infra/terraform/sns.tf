# S3 restore-events topic + webhook delivery — behavior context: docs/guides/webhooks.md

resource "aws_sns_topic" "s3_restore_events" {
  name = "nexus-s3-restore-events-${var.environment}"
}

resource "aws_sns_topic_policy" "s3_restore_events" {
  arn = aws_sns_topic.s3_restore_events.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "SNS:Publish"
      Resource  = aws_sns_topic.s3_restore_events.arn
      Condition = {
        ArnLike = { "aws:SourceArn" = aws_s3_bucket.files.arn }
      }
    }]
  })
}

# Failed webhook deliveries land here via the subscription's redrive policy.
resource "aws_sqs_queue" "s3_restore_events_dlq" {
  name = "nexus-s3-restore-events-dlq-${var.environment}"
}

resource "aws_sqs_queue_policy" "s3_restore_events_dlq" {
  queue_url = aws_sqs_queue.s3_restore_events_dlq.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.s3_restore_events_dlq.arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_sns_topic.s3_restore_events.arn }
      }
    }]
  })
}

# Raw message delivery must stay OFF: the webhook parses and signature-checks
# the full SNS envelope. The route auto-confirms subscriptions (it fetches
# SubscribeURL), so the app must already be deployed at var.app_domain when
# this applies — Terraform waits for the confirmation.
resource "aws_sns_topic_subscription" "s3_restore_webhook" {
  topic_arn              = aws_sns_topic.s3_restore_events.arn
  protocol               = "https"
  endpoint               = "https://${var.app_domain}/api/webhooks/s3-restore"
  endpoint_auto_confirms = true
  raw_message_delivery   = false

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.s3_restore_events_dlq.arn
  })
}
