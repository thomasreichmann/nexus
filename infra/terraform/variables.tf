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
  description = "Domain of the deployed web app for this environment. Feeds the ops-alerts webhook subscription endpoint (alarms.tf) and the worker Lambda's APP_URL, which is what links in worker-sent emails point at; CORS origins come from cors_allowed_origins."
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

variable "resend_api_key" {
  description = "Resend API key injected into the worker Lambda, which sends the retrieval-ready email (#425). Pass via TF_VAR_resend_api_key; never commit. Note: persisted in Terraform state. Empty leaves the worker unable to send — the app is unaffected, it reads its own Vercel env."
  type        = string
  sensitive   = true
  default     = ""
}

# The two below are deliberately NOT sensitive: the from-address appears in the
# header of every email we send, and a PostHog project key is a write-only
# ingestion key already shipped in the browser bundle. Marking them sensitive
# would cost a TF_VAR on every apply and hide values from `terraform plan` for
# no secrecy gain, so they live in the committed tfvars instead.
variable "resend_from_email" {
  description = "From-address for worker-sent email. Resend accepts a friendly-from format (\"Name <addr@domain>\"); the address's domain must be verified in Resend."
  type        = string
}

variable "posthog_key" {
  description = "PostHog project key for the worker's server-side events — the same public `phc_...` key the app ships as NEXT_PUBLIC_POSTHOG_KEY for this environment. Empty leaves worker analytics off (the client is never constructed)."
  type        = string
  default     = ""
}
