output "droplet_ip" {
  description = "Public IPv4 address of the droplet"
  value       = digitalocean_droplet.this.ipv4_address
}

output "droplet_id" {
  description = "DigitalOcean droplet ID"
  value       = digitalocean_droplet.this.id
}

output "project_id" {
  description = "DigitalOcean Project ID this droplet was assigned to"
  value       = digitalocean_project.this.id
}

output "dns_record" {
  description = "Fully-qualified DNS record created for this droplet"
  value       = cloudflare_record.api.hostname
}

output "firewall_id" {
  description = "DigitalOcean firewall ID - needed by the CD workflow to add/remove a just-in-time SSH rule for the GitHub Actions runner's IP on each deploy"
  value       = digitalocean_firewall.this.id
}
