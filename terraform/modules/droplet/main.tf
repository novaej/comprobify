terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean" }
    cloudflare   = { source = "cloudflare/cloudflare" }
    http         = { source = "hashicorp/http" }
  }
}

resource "digitalocean_ssh_key" "infra" {
  name       = "comprobify-infra-${var.environment}"
  public_key = var.ssh_public_key
}

resource "digitalocean_droplet" "this" {
  name     = "comprobify-${var.environment}"
  region   = var.region
  size     = var.droplet_size
  image    = var.image_slug
  ssh_keys = [digitalocean_ssh_key.infra.id]

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    environment     = var.environment
    deploy_username = var.deploy_username
    ssh_public_key  = var.ssh_public_key
  })
}

# Deliberately NOT created with droplet_id set inline (the resource supports that, but
# doing so makes this resource implicitly depend on digitalocean_droplet.this). Kept as
# its own free-standing, region-scoped resource plus a separate
# digitalocean_reserved_ip_assignment below, so that a droplet replacement (any "ForceNew"
# attribute change, e.g. user_data/cloud-init edits, or the SSH key rotation flow in
# terraform-digitalocean-setup.md) only ever touches the assignment, never this resource —
# the IP itself survives, and only needs re-pointing at the new droplet id, not
# re-provisioning or re-registering in DNS/GitHub Secrets. Free of charge as long as it
# stays assigned to a droplet (DigitalOcean only bills a reserved IP while it's
# unassigned).
resource "digitalocean_reserved_ip" "this" {
  region = var.region

  # This resource's own droplet_id field is Optional, not Computed - leaving it unset
  # in config (deliberately, per the comment above) otherwise makes Terraform plan to
  # clear it on every apply, since the real API object has it populated (by whichever
  # droplet digitalocean_reserved_ip_assignment currently points it at) while our
  # config declares nothing. Ignoring it here is what actually lets the two resources
  # coexist without fighting over the same field - digitalocean_reserved_ip_assignment
  # is the sole owner of the droplet<->IP relationship.
  lifecycle {
    ignore_changes = [droplet_id]
  }
}

resource "digitalocean_reserved_ip_assignment" "this" {
  ip_address = digitalocean_reserved_ip.this.ip_address
  droplet_id = digitalocean_droplet.this.id
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

  # SSH open to the internet, deliberately - both personal access and the CD
  # pipeline (GitHub-hosted runners with no fixed IP) need to reach it, and IP
  # restriction here proved unreliable in practice (see terraform-digitalocean-setup.md's
  # SSH access model section for why). Defense is layered elsewhere instead: key-only
  # auth, no root login, an unprivileged deploy user with no sudo, fail2ban, and
  # MaxAuthTries/LoginGraceTime limits - all in cloud-init.yaml.tftpl's sshd hardening.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0"]
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
  # The reserved IP, not digitalocean_droplet.this.ipv4_address — this is the whole
  # point of the reserved IP: a droplet replacement no longer moves this record.
  content = digitalocean_reserved_ip.this.ip_address
  proxied = true
  ttl     = 1 # required to be 1 ("automatic") when proxied = true
}
