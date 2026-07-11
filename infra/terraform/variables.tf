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
  description = "Domain of the deployed web app for this environment. Used for the SNS webhook subscription endpoint and S3 CORS."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origins allowed to make browser requests (presigned uploads/downloads) against the files bucket."
  type        = list(string)
}

variable "webhook_bypass_query" {
  description = "Optional query string (with leading '?') appended to the SNS webhook endpoint. Dev needs it: the dev app runs on a Vercel preview URL behind deployment protection, so the subscription carries the project's Protection Bypass for Automation token (?x-vercel-protection-bypass=...). Pass via TF_VAR_webhook_bypass_query; never commit. Persisted in Terraform state and visible in the SNS subscription config."
  type        = string
  default     = ""
  sensitive   = true

  # Guardrails: the var is sensitive, so a bad value would hide inside
  # "endpoint = (sensitive value)" in the plan instead of being visible.
  validation {
    condition     = var.environment != "prod" || var.webhook_bypass_query == ""
    error_message = "webhook_bypass_query is dev-only; unset TF_VAR_webhook_bypass_query for prod applies."
  }

  validation {
    condition     = can(regex("^$|^\\?", var.webhook_bypass_query))
    error_message = "webhook_bypass_query must be empty or start with '?'."
  }
}

variable "database_url" {
  description = "Supabase transaction-pooler URL (port 6543) injected into the worker Lambda. Pass via TF_VAR_database_url; never commit. Note: persisted in Terraform state."
  type        = string
  sensitive   = true
}
