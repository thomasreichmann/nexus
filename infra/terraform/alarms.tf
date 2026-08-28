# Ops alarms -> SNS -> /api/webhooks/cloudwatch-alarm -> Discord.
# HTTPS subscription carrying the full SNS envelope (raw delivery OFF — the
# route signature-checks it), the route auto-confirms, and failed deliveries
# land in a DLQ for inspection. This is the last SNS rail in the stack: the
# S3 restore-events one was removed with #416.

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

# Out-of-band path: the HTTPS subscription above cannot notify when the app
# itself is what broke, which is exactly what the restore-DLQ alarm below
# exists to catch. Dev stays Discord-only — its DLQs are the noisy ones (#263).
# Terraform reports success while the subscription sits in "pending
# confirmation"; the click is manual (README "After apply").
resource "aws_sns_topic_subscription" "ops_alerts_email" {
  count = var.environment == "prod" ? 1 : 0

  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Every DLQ in the stack, alarmed on depth > 0. A parked message always means a
# silent failure — nothing retries out of a DLQ on its own — so the threshold is
# the floor rather than a tuned number, and ok_actions fires the recovery notice
# once the queue drains.
locals {
  dlq_alarms = {
    # Primary defense for the thumbnail pipeline (#350): a job that exhausts its
    # 3 SQS attempts parks here, and a redrive within ~24h still beats the
    # originals' Deep Archive transition. Depth > 0 means systemic breakage
    # (worker down, bad deploy).
    jobs = {
      queue_name  = aws_sqs_queue.jobs_dlq.name
      description = "Background-jobs DLQ has parked messages; redrive within 24h to beat the Deep Archive transition (#350)"
    }

    # Zip builds (#424). A parked job here means a restore the user was
    # promised never becomes downloadable, and the redrive window is hard: the
    # thawed originals the build reads lapse after ZIP_BUILD_RESTORE_DAYS, so
    # this is the alarm that has to reach someone before they do.
    zip-jobs = {
      queue_name  = aws_sqs_queue.zip_jobs_dlq.name
      description = "Zip-build DLQ has parked messages; redrive before the thawed originals lapse (#424)"
    }

    # Watches the alerting rail itself: if the Discord webhook endpoint is
    # unreachable, the alarms above park here and nothing else notices. In prod
    # the email subscription still delivers when the HTTPS endpoint is the
    # broken part. In dev it is genuinely circular — the notification goes to a
    # topic whose only subscriber is the dead endpoint — so the dev alarm is
    # console-only, kept for parity rather than paging value.
    ops-alerts = {
      queue_name  = aws_sqs_queue.ops_alerts_dlq.name
      description = "Alarm notifications are failing to reach Discord; check that the app is serving /api/webhooks/cloudwatch-alarm"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  for_each = local.dlq_alarms

  alarm_name          = "nexus-${each.key}-dlq-depth-${var.environment}"
  alarm_description   = each.value.description
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value.queue_name
  }

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]
}

# The jobs alarm shipped standalone in #350 and is already applied in both
# workspaces. Re-keying it into the for_each above is a rename, not a
# replacement — the alarm_name is unchanged.
moved {
  from = aws_cloudwatch_metric_alarm.jobs_dlq_depth
  to   = aws_cloudwatch_metric_alarm.dlq_depth["jobs"]
}
