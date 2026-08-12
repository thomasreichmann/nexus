# Ops alarms -> SNS -> /api/webhooks/cloudwatch-alarm -> Discord.
# Mirrors the s3-restore SNS rail (sns.tf): HTTPS subscription with the full
# SNS envelope (raw delivery OFF — the route signature-checks it), the route
# auto-confirms, failed deliveries land in a DLQ for inspection.

resource "aws_sns_topic" "ops_alerts" {
  name = "nexus-ops-alerts-${var.environment}"
}

resource "aws_sqs_queue" "ops_alerts_dlq" {
  name = "nexus-ops-alerts-dlq-${var.environment}"
}

resource "aws_sqs_queue_policy" "ops_alerts_dlq" {
  queue_url = aws_sqs_queue.ops_alerts_dlq.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.ops_alerts_dlq.arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_sns_topic.ops_alerts.arn }
      }
    }]
  })
}

resource "aws_sns_topic_subscription" "ops_alerts_webhook" {
  topic_arn              = aws_sns_topic.ops_alerts.arn
  protocol               = "https"
  endpoint               = "https://${var.app_domain}/api/webhooks/cloudwatch-alarm"
  endpoint_auto_confirms = true
  raw_message_delivery   = false

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ops_alerts_dlq.arn
  })
}

# Primary defense for the thumbnail pipeline (#350): a job that exhausts its
# 3 SQS attempts parks in the jobs DLQ, and a redrive within ~24h still beats
# the originals' Deep Archive transition. Depth > 0 means systemic breakage
# (worker down, bad deploy) — page Discord immediately. ok_actions fires the
# recovery notice once the DLQ is drained.
resource "aws_cloudwatch_metric_alarm" "jobs_dlq_depth" {
  alarm_name          = "nexus-jobs-dlq-depth-${var.environment}"
  alarm_description   = "Background-jobs DLQ has parked messages; redrive within 24h to beat the Deep Archive transition (#350)"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.jobs_dlq.name
  }

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]
}
