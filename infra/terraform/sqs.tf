# Background-jobs queues — spec: docs/guides/background-jobs.md

resource "aws_sqs_queue" "jobs_dlq" {
  name = "nexus-jobs-dlq-${var.environment}"
}

resource "aws_sqs_queue" "jobs" {
  name                       = "nexus-jobs-${var.environment}"
  visibility_timeout_seconds = 60

  # Jobs retry 3 times before moving to the DLQ.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}
