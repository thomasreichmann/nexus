variable "environment" {
  description = "Environment suffix for all resource names (prod, dev)."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be one of: dev, prod."
  }
}

variable "region" {
  description = "AWS region for all resources. Both prod and dev are us-east-1; a sa-east-1 (São Paulo) prod deployment closer to the Brazil alpha testers was reverted 2026-07-09 pending multi-region validation."
  type        = string
}

variable "app_domain" {
  description = "Domain of the deployed web app for this environment. Feeds the ops-alerts webhook subscription endpoint (alarms.tf) only; CORS origins come from cors_allowed_origins."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origins allowed to make browser requests (presigned uploads/downloads) against the files bucket."
  type        = list(string)
}

variable "alert_email" {
  description = "Ops contact for AWS-originated alerts (alarms.tf, budgets.tf); prod-only — see README 'After apply'."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly cap for the account-wide AWS budget (budgets.tf). Defaulted rather than set per environment because the budget is account-global. $20 is a tripwire above expected alpha spend, not a forecast — bump it if ordinary growth starts tripping it."
  type        = number
  default     = 20
}

variable "database_url" {
  description = "Supabase transaction-pooler URL (port 6543) injected into the worker Lambda. Pass via TF_VAR_database_url; never commit. Note: persisted in Terraform state."
  type        = string
  sensitive   = true
}
