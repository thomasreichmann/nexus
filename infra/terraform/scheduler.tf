# Retrieval poll: EventBridge Scheduler -> worker Lambda, every 15 minutes.
#
# Replaces the S3 -> SNS -> webhook rail (#416). Restore completion is observed
# rather than delivered: the worker HEADs the objects behind its own pending
# retrievals, so the request rate is bounded by that set instead of by S3's
# event rate. The interval is invisible against a 12-48h Deep Archive restore.
#
# The schedule delivers a payload with no `Records` key, which is how the
# shared handler tells a poll invocation from an SQS batch
# (apps/worker/src/handler.ts).

resource "aws_scheduler_schedule" "retrieval_poll" {
  name = "nexus-retrieval-poll-${var.environment}"

  # No flexible window: the poll is cheap and idempotent, so there is nothing
  # to gain from letting AWS smear the invocation.
  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "rate(15 minutes)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.worker.arn
    role_arn = aws_iam_role.retrieval_poll_scheduler.arn

    # A run that throws has already logged per-row failures and left those
    # rows pending, so the next tick is the retry. Retrying the whole
    # invocation would re-HEAD rows that already succeeded.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_iam_role" "retrieval_poll_scheduler" {
  name = "nexus-retrieval-poll-scheduler-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "retrieval_poll_invoke" {
  name = "nexus-retrieval-poll-invoke-${var.environment}"
  role = aws_iam_role.retrieval_poll_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.worker.arn
    }]
  })
}

# The scheduled path has no DLQ — an SQS-shaped failure story does not fit a
# timer — so a poll that fails every run would otherwise be silent. This is
# the detector: the function's own error metric, scoped by the same ops-alerts
# rail as the DLQ alarms.
#
# This only works because the poll throws when every pending row fails
# (`pollRetrievals.ts`). Errors is a whole-invocation metric: a run that
# swallows per-row failures and returns a summary is a *success* to CloudWatch,
# however many rows it lost. Keep the two in step — going back to counting
# errors without rethrowing re-opens exactly the blind spot this alarm covers.
resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "nexus-worker-errors-${var.environment}"
  alarm_description   = "The worker Lambda is throwing; the retrieval poll may not be marking restores ready (#416)"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.worker.function_name
  }

  alarm_actions = [aws_sns_topic.ops_alerts.arn]
  ok_actions    = [aws_sns_topic.ops_alerts.arn]
}
