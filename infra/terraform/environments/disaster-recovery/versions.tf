terraform {
  required_version = ">= 1.9.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.44"
    }
  }

  # Backend intentionally unconfigured at bootstrap:
  # [REQUIRED: state backend decision — owner/provider account pending]
}
