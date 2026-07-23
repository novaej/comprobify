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

variable "ssh_public_key" {
  description = "Public half of the dedicated infra SSH key, as its literal OpenSSH-format content (e.g. \"ssh-ed25519 AAAA... comprobify-deploy\") - not a path. A public key confers no access on its own (that's the private half's job), so it's safe to pass as a plain, non-sensitive value and commit in terraform.tfvars; deliberately not read from a local file path, since that path only exists on whichever machine generated the key and would break every other machine (notably CI, which has no such file) running Terraform against this config."
  type        = string
}

variable "deploy_username" {
  description = "Unprivileged Linux user created on the droplet for SSH access (personal and CD alike) - deliberately not root, and deliberately not a guessable name like \"deploy\"/\"admin\"/\"ubuntu\". Granted docker group membership only, no sudo; see cloud-init.yaml.tftpl."
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
