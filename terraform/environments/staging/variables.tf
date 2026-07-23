variable "do_token" {
  description = "DigitalOcean API token (comprobify-terraform-staging). Supply via TF_VAR_do_token, never in a committed file."
  type        = string
  sensitive   = true
}

variable "cloudflare_token" {
  description = "Cloudflare API token (comprobify-terraform-staging), scoped to the comprobify.com zone. Supply via TF_VAR_cloudflare_token, never in a committed file."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DigitalOcean region slug"
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "DigitalOcean droplet size slug"
  type        = string
  default     = "s-1vcpu-512mb-10gb"
}

variable "ssh_public_key_path" {
  description = "Path to the public half of the dedicated infra SSH key"
  type        = string
  default     = "~/.ssh/comprobify_infra.pub"
}

variable "admin_ip_cidr" {
  description = "Your public IP, as a /32 CIDR, allowed to reach the droplet over SSH"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for comprobify.com"
  type        = string
}

variable "subdomain" {
  description = "DNS record name for this environment"
  type        = string
  default     = "api-staging"
}
