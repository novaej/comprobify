terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean" }
    cloudflare   = { source = "cloudflare/cloudflare" }
    http         = { source = "hashicorp/http" }
  }
}

resource "digitalocean_ssh_key" "infra" {
  name       = "comprobify-infra-${var.environment}"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "digitalocean_droplet" "this" {
  name     = "comprobify-${var.environment}"
  region   = var.region
  size     = var.droplet_size
  image    = var.image_slug
  ssh_keys = [digitalocean_ssh_key.infra.id]

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    environment = var.environment
  })
}

# Cloudflare's published IPv4 ranges, fetched live instead of hardcoded — avoids the
# firewall silently going stale if Cloudflare ever changes the list. See
# https://www.cloudflare.com/ips-v4
data "http" "cloudflare_ipv4" {
  url = "https://www.cloudflare.com/ips-v4"
}

locals {
  cloudflare_ipv4_ranges = compact(split("\n", data.http.cloudflare_ipv4.response_body))
}

resource "digitalocean_firewall" "this" {
  name        = "comprobify-${var.environment}-fw"
  droplet_ids = [digitalocean_droplet.this.id]

  # 80/443 restricted to Cloudflare's IP ranges only — bypassing this by hitting the
  # droplet's raw IP directly would skip Cloudflare's proxy (and its WAF/DDoS
  # protection) entirely.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = local.cloudflare_ipv4_ranges
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = local.cloudflare_ipv4_ranges
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.admin_ip_cidr]
  }

  # Both protocols outbound — TCP alone would silently break DNS resolution
  # (UDP/53), which everything from `apt` to `docker pull` depends on.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

resource "digitalocean_project" "this" {
  name        = "Comprobify ${title(var.environment)}"
  description = "Comprobify ${var.environment} infrastructure"
  purpose     = "Web Application"
  environment = var.environment == "production" ? "Production" : "Staging"
}

resource "digitalocean_project_resources" "this" {
  project = digitalocean_project.this.id
  resources = [
    digitalocean_droplet.this.urn,
  ]
}

resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain
  type    = "A"
  content = digitalocean_droplet.this.ipv4_address
  proxied = true
  ttl     = 1 # required to be 1 ("automatic") when proxied = true
}
