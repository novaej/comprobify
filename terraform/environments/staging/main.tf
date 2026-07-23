terraform {
  required_version = ">= 1.7"
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean", version = "~> 2.40" }
    cloudflare   = { source = "cloudflare/cloudflare",     version = "~> 4.0" }
    http         = { source = "hashicorp/http",            version = "~> 3.4" }
  }
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_token
}

module "staging" {
  source = "../../modules/droplet"

  environment        = "staging"
  region             = var.region
  droplet_size       = var.droplet_size
  ssh_public_key     = var.ssh_public_key
  deploy_username    = var.deploy_username
  cloudflare_zone_id = var.cloudflare_zone_id
  subdomain          = var.subdomain
}
