data "aws_caller_identity" "current" {}

# The selected workspace must match var.environment so prod state can never
# be mutated with dev tfvars (or vice versa).
resource "terraform_data" "workspace_environment_guard" {
  lifecycle {
    precondition {
      condition     = terraform.workspace == var.environment
      error_message = "Workspace '${terraform.workspace}' does not match environment '${var.environment}'. Run: terraform workspace select ${var.environment}"
    }
  }
}
