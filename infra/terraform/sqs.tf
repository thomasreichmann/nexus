# Background-jobs queues — spec: docs/guides/background-jobs.md
#
# Deliberately no prevent_destroy (unlike the files bucket): these buffer
# in-flight messages rather than store data, and the bucket's guard already
# fails a blanket destroy at plan time before any queue is reached.

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
