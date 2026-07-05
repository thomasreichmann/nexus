provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project     = "nexus"
      environment = var.environment
      managed-by  = "terraform"
    }
  }
}
