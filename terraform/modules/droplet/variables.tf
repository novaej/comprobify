variable "environment" {
  description = "Environment name: \"staging\" or \"production\""
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be \"staging\" or \"production\"."
  }
}

variable "region" {
  description = "DigitalOcean region slug, e.g. \"nyc3\""
  type        = string
}

variable "droplet_size" {
  description = "DigitalOcean droplet size slug, e.g. \"s-1vcpu-512mb-10gb\""
  type        = string
}

variable "image_slug" {
  description = "DigitalOcean base OS image slug. Deliberately a plain distribution image, not a Marketplace app image (e.g. the Docker-preinstalled one) — several Marketplace images require more disk than the cheapest droplet tiers provide. Docker is installed via cloud-init instead; see cloud-init.yaml.tftpl."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "ssh_public_key_path" {
  description = "Path to the public half of the dedicated infra SSH key (~ is expanded)"
  type        = string
}

variable "admin_ip_cidr" {
  description = "CIDR allowed to reach the droplet over SSH (port 22), e.g. \"203.0.113.4/32\""
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for comprobify.com"
  type        = string
}

variable "subdomain" {
  description = "DNS record name to create under the zone, e.g. \"api-staging\" or \"api\""
  type        = string
}
