# Background-jobs queues — spec: docs/guides/background-jobs.md
#
# Deliberately no prevent_destroy (unlike the files bucket): these buffer
# in-flight messages rather than store data, and the bucket's guard already
# fails a blanket destroy at plan time before any queue is reached.

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
