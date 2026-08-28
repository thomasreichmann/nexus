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

# Zip builds get their own queue because they get their own function (#424): a
# multi-gigabyte streaming pass needs the 15-minute Lambda maximum, and sharing
# a queue would hand that timeout to every thumbnail job too. Not an SQS filter
# on the queue above — those silently delete non-matching messages.
resource "aws_sqs_queue" "zip_jobs_dlq" {
  name = "nexus-zip-jobs-dlq-${var.environment}"
}

resource "aws_sqs_queue" "zip_jobs" {
  name = "nexus-zip-jobs-${var.environment}"
  # 6x the zip worker's 900s timeout, the same ratio the jobs queue uses.
  visibility_timeout_seconds = 5400

  # Three attempts, as above. A parked zip job has to reach a human before the
  # thawed originals lapse — see ZIP_BUILD_RESTORE_DAYS for why that window is
  # a redrive budget rather than a build budget.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.zip_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}
