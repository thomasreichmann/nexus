# Background-jobs queues — spec: docs/guides/background-jobs.md

resource "aws_sqs_queue" "jobs_dlq" {
  name = "nexus-jobs-dlq-${var.environment}"
}

resource "aws_sqs_queue" "jobs" {
  name = "nexus-jobs-${var.environment}"
  # Must be >= the worker Lambda's timeout (120s) for the event source
  # mapping; AWS recommends 6x. Governs retry latency: a failed attempt
  # becomes visible again after this long.
  visibility_timeout_seconds = 720

  # Jobs retry 3 times before moving to the DLQ.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}
