# Account-wide cost tripwire. Glacier restores are user-selectable and uncapped
# beyond fileIds.max(10000) per call (server/trpc/routers/files.ts), issued by
# the worker's initiate-restore handler, so a runaway retrieval is otherwise
# invisible until the bill arrives. The default tier is Bulk since #423
# ($0.0025/GB), which is the cheap end — Standard and Expedited are 8x and up.
#
# Budgets are account-global, not regional or per-environment: created from the
# prod workspace only, or the two workspaces would fight over one resource.
#
# Notifies var.alert_email directly rather than through aws_sns_topic.ops_alerts:
# Budgets needs an explicit topic policy allowing budgets.amazonaws.com to
# publish, and attaching aws_sns_topic_policy replaces the implicit default that
# currently lets CloudWatch alarms publish — a silent way to break every alarm
# in alarms.tf.
resource "aws_budgets_budget" "monthly_cost" {
  count = var.environment == "prod" ? 1 : 0

  name              = "nexus-monthly-cost"
  budget_type       = "COST"
  limit_amount      = var.monthly_budget_usd
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-08-01_00:00"

  # Actual at 80% is the "something changed" nudge; forecast at 100% is the one
  # that fires early enough in the month to still act on.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
