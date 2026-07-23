region              = "nyc3"
droplet_size        = "s-1vcpu-512mb-10gb"
ssh_public_key_path = "~/.ssh/comprobify_infra.pub"
subdomain           = "api-staging"

# Update this and run `terraform apply` whenever SSH access stops working — see
# docs/terraform-digitalocean-setup.md's "Day-2 operations" for what to check first.
admin_ip_cidr      = "157.100.202.239/32"
cloudflare_zone_id = "7d75cca935a373030ac39b7f1ba7696c"
