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

variable "ssh_public_key" {
  description = "Public half of the dedicated infra SSH key, as its literal OpenSSH-format content - see modules/droplet/variables.tf for why this is a value, not a path"
  type        = string
}

variable "deploy_username" {
  description = "Unprivileged Linux user for SSH access (personal and CD alike) - not a guessable name like \"deploy\"/\"admin\"/\"ubuntu\""
  type        = string
  default     = "cpfydeploy9x"
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
