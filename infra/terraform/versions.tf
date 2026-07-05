terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # One state bucket for all environments; workspaces separate them
  # (prod state lives at env:/prod/nexus.tfstate). The bucket is bootstrapped
  # manually once — see README.md. It lives in us-east-1 regardless of
  # var.region because state is environment-agnostic.
  backend "s3" {
    bucket       = "nexus-terraform-state-391615358272"
    key          = "nexus.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
