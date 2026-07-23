# Terraform + DigitalOcean — Infrastructure Setup

Reference for how the API/worker compute layer is provisioned and deployed on DigitalOcean: droplets managed by Terraform, application code deployed via a separate GitHub Actions CI/CD pipeline. This is the living "how does our infrastructure actually work" document. Staging was originally hosted on Render; `docs/deployment.md` covers what's unaffected by that move (branching strategy, environment variables, migrations, SRI environments).

**What lives on DigitalOcean:** one droplet per environment (`staging`, `production`), each running the `api` and `worker` containers behind a Caddy reverse proxy.

**What doesn't:** Neon (Postgres), CloudAMQP (RabbitMQ), Mailgun, Sentry, and Cloudflare (DNS/proxy, registrar) — all external managed services, unaffected by anything in this document. `comprobify-web` (Vercel) is entirely out of scope too.

---

## Overview of the flow

Two independent pipelines, deliberately never triggering each other:

1. **Infrastructure pipeline (Terraform)** — rare, reviewed changes: create/resize/destroy a droplet, change a firewall rule, update a DNS record. Run locally or via a gated GitHub Actions workflow.
2. **Application pipeline (GitHub Actions CI/CD)** — frequent: every push to `staging`/`production` builds a Docker image, pushes it to a registry, and tells the target droplet to pull + restart the containers. Never invokes Terraform.

```
                    ┌──────────────────────┐
  terraform apply   │  DigitalOcean API +  │   creates/updates droplet,
  (rare, reviewed)  │   Cloudflare API     │   firewall, SSH key, DNS record
 ──────────────────▶│                      │
                    └───────────┬──────────┘
                                │ cloud-init (first boot only:
                                │ hardening, nothing app-specific)
                                ▼
                    ┌──────────────────────┐
                    │   Droplet (Docker)    │
                    │  ┌────────┐┌────────┐ │
  docker compose    │  │  api   ││ worker │ │◀── pulls image from GHCR
  pull && up -d     │  └────────┘└────────┘ │
  (every app push)  └──────────────────────┘
        ▲
        │ SSH, triggered by GitHub Actions on push to staging/production
```

A code deploy can never accidentally recreate a droplet; an infra change can never accidentally ship new app code.

---

## Tools used, briefly

Everything this setup touches, in one place — what each thing is and what it's actually doing for us, without needing to piece it together from the sections below.

| Tool | What it is | What it does here |
|---|---|---|
| **Terraform** | Infrastructure-as-code CLI (HashiCorp) | Reads `.tf` files describing what infrastructure *should* exist and makes reality match — creates, updates, or destroys the droplet/firewall/DNS record/etc. Tracks everything it manages in a state file so it knows what to leave alone on the next run. |
| **DigitalOcean (DO)** | Cloud provider | Hosts the actual server. Comparable to AWS/GCP, aimed at simpler, cheaper setups like this one. |
| **Droplet** | DO's name for a virtual machine | The actual computer our containers run on. One per environment. |
| **DO Spaces** | DO's S3-compatible object storage | Used for exactly one thing here: storing Terraform's state file remotely, so it's not just a file on your laptop. Not used for anything app-related. |
| **DO Cloud Firewall** | Network-level firewall, managed by DO outside the droplet itself | Controls which IPs/ports can reach the droplet at all — 80/443 restricted to Cloudflare's ranges; 22 (SSH) deliberately left open, since defense there is layered at the identity level instead (see "SSH access model" below). Distinct from a host-level firewall like `ufw`, which we deliberately don't run (checked and confirmed inactive). |
| **Cloudflare** | DNS + reverse proxy/CDN service | Owns the domain's DNS (which IP `api-staging.comprobify.com` resolves to) and proxies all public traffic, so clients never see the droplet's real IP directly — also gives free DDoS/WAF protection in front of it. |
| **cloud-init** | Standard first-boot configuration tool, supported by most cloud providers | Runs once, automatically, the very first time a droplet boots — reads the `user_data` Terraform hands it and executes it. Ours installs Docker, hardens SSH, and starts `fail2ban`. Never runs again after that first boot, even across reboots. |
| **Docker** | Container runtime | Runs the app as an isolated "container" — a packaged unit with everything the app needs to run, independent of whatever else is on the machine. |
| **Docker Compose** | Tool for running multiple containers together as one unit | Defines `api`, `worker`, and `caddy` as one coordinated stack in `deploy/docker-compose.yml` — one command (`docker compose up -d`) starts/updates all three together. |
| **Caddy** | Web server / reverse proxy | The only container with ports actually exposed to the internet (80/443). Forwards incoming requests to the `api` container internally, and automatically obtains/renews the HTTPS certificate with zero manual config. |
| **fail2ban** | Intrusion-prevention tool | Watches for repeated failed SSH login attempts and temporarily bans the offending IP at the firewall level — the main defense against brute-force attempts now that SSH is open to any source IP. |
| **unattended-upgrades** | Automatic security patching | Installs OS security patches in the background on a schedule, without anyone needing to SSH in and run `apt upgrade` by hand. |
| **GitHub Actions** | CI/CD automation built into GitHub | Runs workflows automatically on events like a push — building the Docker image, pushing it, and telling the droplet to pull and restart. |
| **GHCR (GitHub Container Registry)** | Docker image registry, part of GitHub | Where the built app image gets pushed to after every deploy-triggering push, so the droplet has somewhere to pull it from. |

---

## Prerequisites

### Accounts / tokens

| What | Where to get it | Used for |
|---|---|---|
| DigitalOcean API token | DO dashboard → API → Generate New Token (read+write) | Terraform's `digitalocean` provider |
| **Two** Cloudflare API tokens — `comprobify-terraform-staging` and `comprobify-terraform-production` | Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom, scoped to the `comprobify.com` zone only, with `Zone:DNS:Edit` + `Zone:Zone:Read`. Keep this separate from any token used for other purposes (e.g. docs site deploys), and don't share one token across both environments — Cloudflare tokens scope permissions at the zone level, not per-record, so this isn't a hard technical wall between environments, but it does mean a leaked staging token can be revoked without touching production's. | Terraform's `cloudflare` provider, one per environment |
| SSH key pair, dedicated to this infra | Generate one below — don't reuse a personal key | Access for the unprivileged deploy user cloud-init creates (see "SSH access model" below) — not root |
| DO Spaces access key, scoped to the state bucket only | DO dashboard → API → Spaces Keys | Terraform remote state backend |

```bash
ssh-keygen -t ed25519 -C "comprobify-deploy" -f ~/.ssh/comprobify_deploy
```

### Local tools (macOS)

```bash
brew install hashicorp/tap/terraform
terraform -version        # pin/confirm against the required_version in terraform/*/main.tf

brew install doctl         # optional — DO CLI, handy for ad-hoc checks
doctl auth init            # paste the DO API token when prompted
```

Terraform is only ever installed on your laptop and the GitHub Actions runner (via `hashicorp/setup-terraform`) — **never on the droplet itself**. The droplet only needs Docker, installed via the DO Docker marketplace image + cloud-init.

---

## Repo layout

```
terraform/
├── modules/
│   └── droplet/                   # shared module: droplet + firewall + DNS + cloud-init
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── cloud-init.yaml.tftpl
├── environments/
│   ├── staging/
│   │   ├── main.tf                 # calls the droplet module with staging's variables
│   │   ├── backend.tf              # staging's own remote state target
│   │   └── terraform.tfvars        # non-secret values only (region, size, subdomain)
│   └── production/
│       ├── main.tf
│       ├── backend.tf
│       └── terraform.tfvars
```

**Separate state per environment** (own `backend.tf`/state key each), not Terraform workspaces sharing one backend — so a `terraform destroy` run against staging has no code path that can reach production's state, ever.

---

## DO Projects — where the resources actually live

A DigitalOcean **Project** is a dashboard-only grouping (which droplets/volumes/etc. show up together in the UI) — it is **not** a network or security boundary. The real isolation between staging and prod comes entirely from what's already covered above: separate droplets, separate Terraform state, separate firewalls, separate secrets. A Project changes nothing about what can reach what.

That said, create one anyway — purely so the DO dashboard doesn't mix a staging droplet and a prod droplet in one flat list. It's Terraform-managed too:

```hcl
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
```

Two entirely separate Projects (`Comprobify Staging`, `Comprobify Production`) — DO has no nested "one Project, multiple Environments" concept.

---

## Remote state

Don't leave state as a local file past initial experimentation. Simplest option given you're already on DO: a DO **Spaces** bucket (S3-compatible).

```hcl
# environments/staging/backend.tf
terraform {
  backend "s3" {
    endpoints = {
      s3 = "https://nyc3.digitaloceanspaces.com"
    }
    region                      = "us-east-1"     # required by the S3 backend syntax, ignored by Spaces
    bucket                      = "comprobify-terraform-state"
    key                         = "staging/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
```

Two flags here exist specifically because DO Spaces (or any non-AWS S3-compatible store) isn't AWS, not just cosmetic tuning:

- **`skip_requesting_account_id`** — without it, Terraform's S3 backend tries to look up the AWS account ID via STS `GetCallerIdentity` / IAM `ListRoles` by default. DO Spaces doesn't implement either API, so `init` fails with a `403 InvalidClientTokenId` even though the credentials are correct — the error is misleading, it's not actually a credentials problem.
- **`skip_s3_checksum`** — newer AWS SDK versions send checksum headers on S3 writes that not every S3-compatible provider supports; skipping avoids a similar spurious failure.

Also note `endpoints.s3` (a full URL with scheme) replaces the older bare-hostname `endpoint` parameter, which is deprecated as of recent Terraform versions.

Production uses the same bucket with `key = "production/terraform.tfstate"`. Credentials come from environment variables, never written into the file — set these in your own terminal, never paste real values into a chat or commit message:

```bash
export AWS_ACCESS_KEY_ID="<spaces-access-key>"
export AWS_SECRET_ACCESS_KEY="<spaces-secret-key>"
```

> The bucket itself is a one-time, chicken-and-egg manual step (create it in the DO dashboard before `terraform init` can use it as a backend) — it can't be managed by the same Terraform config that depends on it existing. Use Standard storage, not a cold/infrequent-access tier — state is read and written on every `plan`/`apply`, the opposite access pattern a cold tier is optimized for. Leave CDN off — state must stay private and always fresh, never cached or publicly exposed.

---

## Provider setup

```hcl
# environments/staging/main.tf
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
```

Terraform auto-reads `TF_VAR_<name>` environment variables — this is how secrets get in without ever touching a `.tfvars` file that could be committed:

```bash
export TF_VAR_do_token="dop_v1_xxxxx"
export TF_VAR_cloudflare_token="xxxxx"
```

---

## The droplet module (what actually gets created)

One module, reused by both environments with different variable values.

```hcl
resource "digitalocean_ssh_key" "infra" {
  name       = "comprobify-infra-${var.environment}"
  public_key = var.ssh_public_key
}

resource "digitalocean_droplet" "this" {
  name      = "comprobify-${var.environment}"
  region    = var.region             # e.g. "nyc3"
  size      = var.droplet_size       # e.g. "s-1vcpu-512mb-10gb" — the $4/mo tier, staging
  image     = var.image_slug         # plain base OS image — see note below
  ssh_keys  = [digitalocean_ssh_key.infra.id]
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    environment     = var.environment
    deploy_username = var.deploy_username
    ssh_public_key  = var.ssh_public_key
  })
}

# Free-standing, region-scoped — deliberately not created with droplet_id set inline
# (the resource supports it, but that makes this implicitly depend on the droplet). See
# "Reserved IP" below for why.
resource "digitalocean_reserved_ip" "this" {
  region = var.region
}

resource "digitalocean_reserved_ip_assignment" "this" {
  ip_address = digitalocean_reserved_ip.this.ip_address
  droplet_id = digitalocean_droplet.this.id
}

# Cloudflare's published IP ranges, fetched live instead of hardcoded — avoids the
# firewall silently going stale if Cloudflare ever changes the list.
data "http" "cloudflare_ipv4" {
  url = "https://www.cloudflare.com/ips-v4"
}

locals {
  cloudflare_ipv4_ranges = compact(split("\n", data.http.cloudflare_ipv4.response_body))
}

resource "digitalocean_firewall" "this" {
  name        = "comprobify-${var.environment}-fw"
  droplet_ids = [digitalocean_droplet.this.id]

  # 80/443 restricted to Cloudflare's IP ranges only. Bypassing this by hitting the
  # droplet's raw IP directly would skip Cloudflare's proxy — and its WAF/DDoS
  # protection — entirely.
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
  # SSH open to the internet, deliberately - see "SSH access model" below for why.
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

resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain          # "api-staging" or "api"
  type    = "A"
  content = digitalocean_reserved_ip.this.ip_address  # not the droplet's own IP — see "Reserved IP" below
  proxied = true
  ttl     = 1                      # required to be 1 ("automatic") when proxied = true
}
```

The DNS record's `content` referencing `digitalocean_reserved_ip.this.ip_address` is what makes destroy/recreate cycles (see Day-2 operations below) keep DNS — and the CD pipeline's `DROPLET_IP` secret — untouched, since the reserved IP doesn't change across a droplet replacement. See "Reserved IP" immediately below for the full reasoning.

**`ssh_public_key` is the literal OpenSSH-format key content (`"ssh-ed25519 AAAA... comprobify-deploy"`), not a path.** An earlier version read it via `file(pathexpand(var.ssh_public_key_path))`, which worked locally but broke the first real CI run — `terraform.yml`'s runner has no `~/.ssh/comprobify_deploy.pub`, since that file only ever existed on whoever generated the key. A public key confers no access by itself (only the private half does), so it's safe to pass as a plain value and commit directly in `terraform.tfvars` — no GitHub secret needed, and it works identically whether Terraform runs on your laptop or in CI.

### Reserved IP — decoupling the public IP from the droplet's lifecycle

A plain `digitalocean_droplet` gets a new public IPv4 address every time it's replaced — not just an explicit `terraform destroy`/`apply`, but also any `apply` touching a "ForceNew" attribute (`user_data`/cloud-init edits, the SSH key rotation flow — see "Day-2 operations" below). Every such replacement used to mean updating the `DROPLET_IP` GitHub Secret by hand and waiting for Cloudflare's DNS record to catch up, or the next deploy would SSH/SCP to a dead IP.

A DigitalOcean **Reserved IP** (`digitalocean_reserved_ip`) fixes this: it's a standalone, region-scoped resource, independent of any droplet, that can be re-pointed at a different droplet at any time. **It's free of charge for as long as it stays assigned to a droplet** — DigitalOcean only bills a reserved IP while it sits unassigned, which never happens here since `digitalocean_reserved_ip_assignment` keeps it attached continuously (including across a replacement — the assignment resource just gets updated to point at the new droplet id in the same `apply`).

It's created **without** `droplet_id` set inline, even though the resource supports that shorthand — setting it inline would make `digitalocean_reserved_ip` implicitly depend on `digitalocean_droplet.this`, defeating the whole point. Instead, a separate `digitalocean_reserved_ip_assignment` resource holds the droplet pointer, so a droplet replacement only ever touches the assignment, never recreates the reserved IP itself.

**What now points at the reserved IP instead of the droplet's own (ephemeral) address:**
- `cloudflare_record.api`'s `content` (above)
- The `reserved_ip` module output (`terraform/modules/droplet/outputs.tf`) — use this, not `droplet_ip`, for the `DROPLET_IP` GitHub Secret and any manual SSH access
- `droplet_ip` still exists as an output too, but it's now only useful for debugging (confirming the droplet's own address, e.g. to check the reserved IP is actually attached) — never wire it to DNS or `DROPLET_IP` again

**Adopting a Reserved IP on an already-existing droplet** (i.e. one that was provisioned before this resource existed in the config, with `cloudflare_record.api` still pointing at `digitalocean_droplet.this.ipv4_address`): creating the reserved IP through the DigitalOcean dashboard/API first and assigning it to the running droplet works fine as an out-of-band first step, but Terraform then needs to be told about it — otherwise the next `plan` either tries to create a second, conflicting reserved IP or shows a confusing diff. Import both resources into state before running `apply`:

```bash
cd terraform/environments/staging

# Reserved IP itself — import ID is just the IP address
terraform import 'module.staging.digitalocean_reserved_ip.this' <RESERVED_IP_ADDRESS>

# The assignment — import ID is "<ip_address>,<droplet_id>"
# Find the droplet id via `terraform state show module.staging.digitalocean_droplet.this`
# or `doctl compute droplet list`
terraform import 'module.staging.digitalocean_reserved_ip_assignment.this' <RESERVED_IP_ADDRESS>,<DROPLET_ID>

terraform plan   # should now show only the cloudflare_record.api content changing
                  # (from the droplet's old IP to the reserved IP) — nothing to
                  # create/destroy for the reserved IP or its assignment
```

After that `apply`, update the `DROPLET_IP` GitHub Secret to the reserved IP's value (`terraform output reserved_ip`) — from this point on, a droplet replacement never requires touching it again.

### Base image — plain OS, not a Marketplace app image

`image_slug` defaults to `ubuntu-24-04-x64`, a plain DigitalOcean distribution image — deliberately **not** DO's Marketplace "Docker on Ubuntu" one-click image. That was the original plan, but it doesn't fit the cheapest droplet tiers: several Marketplace app images (including the Docker one) require more disk than the $4/mo tier's 10GB provides, and `digitalocean_droplet` creation fails outright with `Cannot create a droplet with a smaller disk than the image` if you try. A plain distribution image has a much smaller footprint and fits comfortably, so Docker is installed by cloud-init instead (next section) — same end state, no forced upgrade to a pricier tier just to get Docker preinstalled.

### cloud-init (first boot only — hardening + installing Docker)

```yaml
#cloud-config
users:
  - name: ${deploy_username}
    lock_passwd: true
    shell: /bin/bash
    ssh_authorized_keys:
      - ${ssh_public_key}

write_files:
  - path: /etc/comprobify-environment
    content: |
      ${environment}
  # Pinned to "noble" (Ubuntu 24.04) since image_slug is fixed to ubuntu-24-04-x64 -
  # update both together if the base image ever changes.
  - path: /etc/apt/sources.list.d/docker.list
    content: |
      deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable
  # SSH hardening as a drop-in file, loaded via the main sshd_config's own
  # `Include /etc/ssh/sshd_config.d/*.conf` (standard on Ubuntu/Debian) - avoids
  # sed-editing the main file, which is brittle against a base image's exact
  # commented-out defaults.
  - path: /etc/ssh/sshd_config.d/99-comprobify-hardening.conf
    content: |
      PasswordAuthentication no
      PermitRootLogin no
      PubkeyAuthentication yes
      ChallengeResponseAuthentication no
      UsePAM yes
      MaxAuthTries 3
      LoginGraceTime 30
      AllowUsers ${deploy_username}

runcmd:
  - mkdir -p /opt/comprobify
  - chown ${deploy_username}:${deploy_username} /opt/comprobify
  # All package installation happens here in runcmd, not via cloud-init's own
  # package_update/packages directives - those can't be given a lock-wait timeout, so a
  # background apt-daily timer grabbing the dpkg lock right after boot can make that
  # module fail outright. Every apt-get call below uses DPkg::Lock::Timeout instead, so
  # it waits out a lock rather than failing if one is briefly held elsewhere.
  - apt-get -o DPkg::Lock::Timeout=120 update
  - apt-get -o DPkg::Lock::Timeout=120 install -y ca-certificates curl
  - install -m 0755 -d /etc/apt/keyrings
  # Docker Engine + Compose plugin from Docker's official apt repo - not the
  # get.docker.com convenience script, which Docker itself advises against for
  # anything beyond quick local testing.
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - apt-get -o DPkg::Lock::Timeout=120 update
  - apt-get -o DPkg::Lock::Timeout=120 install -y fail2ban unattended-upgrades docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  # The "docker" group is created by the docker-ce package install above, so this
  # can't happen earlier in the users: block, which runs before runcmd.
  - usermod -aG docker ${deploy_username}
  - systemctl enable --now fail2ban
  - dpkg-reconfigure -f noninteractive unattended-upgrades
  - systemctl restart ssh
  - systemctl enable --now docker
```

(`systemctl restart ssh`, not `sshd` — Ubuntu names the OpenSSH systemd unit `ssh.service`. An earlier version of this file used `sshd` here, which may have been silently failing this whole time — confirmed via `systemctl status ssh` on the actual droplet before catching it, since we'd always been using key-only auth anyway and never explicitly verified the restart itself succeeded.)

**Keep this file strictly ASCII — no em-dashes, curly quotes, or other multi-byte characters, even in comments.** A single em-dash in a comment here once caused cloud-init to reject the *entire* `user_data` with `Failed loading yaml blob: unacceptable character #x0080`, silently falling back to an empty config — `cloud-init status` still reported `done` (nothing failed, because nothing ran: not `write_files`, not `runcmd`, not even `mkdir -p /opt/comprobify`, the very first command). The droplet came up looking healthy while doing none of the setup it was supposed to. `extended_status: degraded done` (visible via `cloud-init status --long`, not the plain `cloud-init status`) is the tell — check that field first if a freshly-created droplet is missing anything cloud-init was supposed to set up. Before trusting a `.tftpl` edit here, verify it's pure ASCII:
```bash
grep -n -P '[^\x00-\x7F]' terraform/modules/droplet/cloud-init.yaml.tftpl
```
No output means clean.

**All package installation deliberately lives in `runcmd`, not cloud-init's `package_update`/`packages` directives.** An earlier version used those directives for `fail2ban`/`unattended-upgrades`/`ca-certificates`/`curl`, and hit a second, separate `degraded done` cause: `apt-get update` exit code 100 from apt/dpkg lock contention with Ubuntu's background `apt-daily` timer racing it right after boot. That specific run didn't actually lose anything (the base image's package index happened to be fresh enough that later installs succeeded anyway, confirmed by checking `fail2ban`'s status and `dpkg -l` directly) — but that was luck, not a guarantee the next base image or timing would repeat it. `DPkg::Lock::Timeout=120` on every `apt-get` call here means a lock held by `apt-daily` gets waited out for up to two minutes instead of failing the command outright, which cloud-init's own package module can't be configured to do.

Deliberately does **not** set up the app's `docker-compose.yml` or secrets — only the empty target directory. Everything inside it is pushed by the CD pipeline, covered next. Terraform's job ends at "droplet exists, hardened, Docker installed, directory ready."

---

## SSH access model

**SSH is open to the internet (`0.0.0.0/0`) on this droplet, deliberately — not an oversight.** Worth explaining how this decision was actually reached, since it wasn't the starting point.

**What was tried first:** SSH restricted to a single `/32` — the admin's own IP. This held up fine for personal access, once an initial scare (a connection timeout that looked exactly like a firewall drop) turned out to just be a newly-created firewall rule needing a moment to propagate, not an actual problem with the restriction. But it created a second, harder problem: the CD pipeline also needs to reach port 22, and GitHub-hosted runners have no fixed IP to permanently allowlist the way a personal connection does.

**Second attempt: a just-in-time firewall rule**, added by the deploy workflow at the start of each run (granting that run's own IP) and removed at the end. More secure in principle — SSH stayed closed to everyone except the admin's `/32` and, briefly, whichever IP a deploy happened to run from. In practice, this added real, ongoing fragility for a small setup to carry: a separate narrowly-scoped DO token to create and keep valid, a Terraform output (`firewall_id`) that needed manual re-syncing to GitHub after certain kinds of recreate, and two real failures in a row (a missing token, then a missing firewall ID) before it ever completed a deploy successfully.

**Where it landed: open SSH, with defense moved to the identity/privilege layer instead of the network layer.** The reasoning: key-only auth already means brute-forcing in is not possible regardless of who can reach port 22 — the real value IP-restriction adds on top of that is (a) less scanning noise reaching sshd at all, and (b) protection against a hypothetical unpatched sshd vulnerability being reachable from anywhere. `unattended-upgrades` already mitigates (b) by keeping sshd itself patched automatically, and the layers below more than compensate for (a):

- **No root login at all** (`PermitRootLogin no`) — SSH never grants a root shell directly, full stop.
- **A single unprivileged deploy user**, `cpfydeploy9x` (deliberately not a guessable name like `deploy`/`admin`/`ubuntu`) — the only account SSH will accept (`AllowUsers`). It's a member of the `docker` group (enough to run `docker`/`docker compose` without elevation) and **has no sudo access at all** — not "sudo for a narrow set of commands," genuinely none. A compromised key gets an attacker a low-privilege shell with no built-in path to root.
- **`MaxAuthTries 3` / `LoginGraceTime 30`** — caps how many auth attempts a single connection gets and how long an unauthenticated connection can be held open, reducing the cost of scanning noise.
- **`fail2ban`** — as before, bans an IP outright after repeated failed attempts.

**If you genuinely need root** (inspecting/editing system config, debugging something `docker`-group access can't reach) — DigitalOcean's browser-based Droplet Console (Droplet → Access → Launch Droplet Console) gives a real root shell through DO's own infrastructure, entirely independent of sshd and everything above. It was always the documented emergency fallback for lockout scenarios; it's now also the *normal* path for anything requiring true root, not just a last resort.

**What this changes for you day to day:** personal SSH access is now `ssh -i ~/.ssh/comprobify_deploy cpfydeploy9x@<ip>`, not `root@<ip>` — `sudo` won't work from this account, so use the Console for anything that genuinely needs it. The CD workflow's `username:` fields changed to match.

---

## The application stack: `docker-compose.yml`, Caddy, and env vars

One file per droplet, committed to the repo, defining every container that runs there. Lives at `deploy/docker-compose.yml` and `deploy/Caddyfile`.

```yaml
# deploy/docker-compose.yml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - api

  api:
    image: ghcr.io/<org>/comprobify:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: .env
    command: node app.js
    expose:
      - "8080"
    mem_limit: 300m

  worker:
    image: ghcr.io/<org>/comprobify:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: .env
    command: node workers/worker.js
    mem_limit: 150m

volumes:
  caddy_data:
  caddy_config:
```

`api` and `worker` run the **same image** — one Dockerfile, one build, one push to GHCR — started with different `command:` values. `expose` (not `ports`) on `api` means it's reachable from `caddy` over the Compose network but never bound to the host directly — only Caddy holds 80/443. `worker` has no `ports`/`expose` at all — it makes outbound connections to RabbitMQ/Neon and needs nothing inbound.

```
# deploy/Caddyfile
api-staging.comprobify.com {
    reverse_proxy api:8080
}
```

Caddy requests its own Let's Encrypt certificate automatically on first request (no config needed) — this works fine sitting behind Cloudflare's proxy since Cloudflare forwards the ACME HTTP-01 challenge through on port 80, which the firewall already allows from Cloudflare's IP ranges.

### Env vars — secrets vs. plain config, and what actually belongs in `.env`

Not every required env var is actually a *secret*. GitHub Actions has two separate per-Environment stores:

- **Secrets** — encrypted, write-only after saving (you can overwrite but never view the value again in the UI), masked as `***` in workflow logs. Use for anything credential-shaped.
- **Variables** (`vars` context) — plain text, visible and editable in the UI, shown unmasked in logs. Use for everything else — there's no benefit to hiding a value like `APP_ENV=staging`, and a real cost: you can't glance at or tweak a Secret without re-typing it blind.

A second, separate decision: not every var `docs/deployment.md`'s table lists needs to be in GitHub or the `.env` file **at all**. Several have a code-level default in `src/config/index.js` that's already the objectively correct value for any environment — for those, omit them entirely and let the code's own default apply, rather than adding noise for zero benefit. **One deliberate exception: `APP_ENV` stays explicit even though `staging`'s value happens to match its own default** — production's correct value (`production`) does *not* match the code's default (`staging`), so a missing `APP_ENV` on the production droplet would silently run as staging with no error at all. A var whose correct value differs across environments needs to stay explicit even in the one environment where it happens to coincide with the default.

Full reference — every var the app reads, whether it needs to be set explicitly, and why:

| Variable | Set explicitly? | Why |
|---|---|---|
| `APP_ENV` | **Yes** | Correct value differs per environment (`staging`/`production`) — see the exception above |
| `APP_BASE_URL` | **Yes** | No default at all |
| `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` | **Yes** | Have defaults (`localhost`, `5432`, `comprobify_local`, `postgres`, `''`) but they point at a local dev Postgres that doesn't exist here — not usable defaults for a real deployment |
| `DB_SSL` | **Yes** | Must be `true` against Neon; default is effectively "off" |
| `ENCRYPTION_KEY` | **Yes** | No default |
| `ADMIN_SECRET` | **Yes** | No default |
| `EMAIL_FROM` | **Yes** | No default, and email is enabled by default (`EMAIL_PROVIDER` defaults to `mailgun`) |
| `EMAIL_FROM_DOCUMENTS` | No | Falls back to `EMAIL_FROM` when unset — a legitimate, often-desired default (same sender for everything). Only set if you want document emails from a different address. |
| `MAILGUN_API_KEY` | **Yes** | No default, required while email is enabled |
| `MAILGUN_DOMAIN` | **Yes** | No default, required while email is enabled |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | **Yes** | No default, required while email is enabled |
| `SENTRY_DSN` | **Yes** (recommended) | Default is silently *disabled monitoring* — not a fatal gap like a missing DB credential, but not something you'd actually want in a real deployment either |
| `BANK_TRANSFER_BANK_NAME`/`ACCOUNT_TYPE`/`ACCOUNT_NUMBER`/`ACCOUNT_HOLDER`/`IDENTIFICATION` | **Yes** | No defaults |
| `ADMIN_NOTIFICATION_EMAIL` | **Yes** | No default; validated as required at startup — the API won't boot without it |
| `OPERATOR_NAME` / `OPERATOR_RUC` / `OPERATOR_EMAIL` | **Yes** | No default; needed before `POST /v1/admin/agreements` will produce correct legal documents |
| `OPERATOR_ADDRESS` | **Yes** (recommended) | Has a generic placeholder default (`"Domicilio disponible previa solicitud razonable"`) that won't crash anything, but isn't your actual address |
| `RABBITMQ_URL` | **Yes** | No default |
| `PORT` | No | Default `8080` already matches the Dockerfile's `EXPOSE` |
| `DOCS_BASE_URL` | No | Default `''` just omits the docs link from error responses — harmless; set it once you have a docs site |
| `VERIFICATION_TOKEN_TTL_HOURS` | No | Default `24` is fine |
| `EMAIL_PROVIDER` | No | Default `mailgun` is the only supported provider today |
| `SRI_TEST_BASE_URL` / `SRI_PROD_BASE_URL` | No | Defaults are the real, correct SRI endpoint URLs |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | No | Defaults (`60000`, `60`) are reasonable |
| `RABBITMQ_SRI_EXCHANGE` | No | Default `sri.direct` is fine |
| `QUEUE_RECONCILE_SEND_STALE_MINUTES` / `QUEUE_RECONCILE_AUTHORIZE_DELAY_MINUTES` / `QUEUE_RECONCILE_AUTHORIZE_STALE_MINUTES` / `QUEUE_RECONCILE_EFFECT_STALE_MINUTES` / `QUEUE_RECONCILE_BATCH_LIMIT` | No | Defaults (`5`, `5`, `5`, `5`, `100`) are reasonable |
| `PENDING_EFFECTS_MAX_ATTEMPTS` | No | Default `5` is fine |
| `IVA_RATE` | **No — must actually be omitted, not set to an empty value** | Default `0.15` is Ecuador's current correct rate, but this one reads via `!== undefined` instead of `||`, so a *present-but-empty* value (what an unset GitHub Variable renders as, if referenced in the heredoc at all) produces `parseFloat('')` = `NaN` and silently corrupts every tax/pricing calculation. Leaving the variable out of GitHub entirely — so it's genuinely absent from the environment, not empty — is the only safe way to get the correct default. Only add it if you need to override the actual rate. |

If you already created a GitHub Secret/Variable for anything in the "No" rows while we were still figuring this out (`QUEUE_RECONCILE_EFFECT_STALE_MINUTES`, `PENDING_EFFECTS_MAX_ATTEMPTS`, `IVA_RATE`, `DOCS_BASE_URL`), it's safe to delete those now — they're unused by the trimmed `.env` heredoc below and won't be referenced by anything.

Split, for the "Yes" rows only:

| GitHub **Secrets** | GitHub **Variables** |
|---|---|
| `ENCRYPTION_KEY` | `APP_ENV`, `APP_BASE_URL` |
| `ADMIN_SECRET` | `DB_SSL` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` (kept together as one group for simplicity, even though a couple of them aren't sensitive alone) | `EMAIL_FROM`, `MAILGUN_DOMAIN` |
| `MAILGUN_API_KEY` | `BANK_TRANSFER_BANK_NAME` / `ACCOUNT_TYPE` / `ACCOUNT_NUMBER` / `ACCOUNT_HOLDER` / `IDENTIFICATION` — `deployment.md` already calls these "Display text only, not a secret" |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | `ADMIN_NOTIFICATION_EMAIL`, `OPERATOR_NAME`, `OPERATOR_RUC`, `OPERATOR_EMAIL`, `OPERATOR_ADDRESS` — an email address and public business-registry identity info, not credentials |
| `RABBITMQ_URL` (embeds credentials) | — |
| `SENTRY_DSN` (not catastrophic if leaked, but conventionally kept private — a leaked DSN lets someone spam fake events into your project) | — |

Both stores are scoped per GitHub Environment (`staging`/`production`) — one place per environment, two tabs (Secrets / Variables) within it.

On every deploy, the CD workflow's SSH step writes the full set into `/opt/comprobify/.env` on the droplet — overwritten each run, so the file always reflects whatever's currently in GitHub:

```yaml
      - uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.DROPLET_IP }}
          username: cpfydeploy9x
          key: ${{ secrets.INFRA_SSH_PRIVATE_KEY }}
          source: "deploy/docker-compose.yml,deploy/Caddyfile"
          target: /opt/comprobify
          strip_components: 1

      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_IP }}
          username: cpfydeploy9x
          key: ${{ secrets.INFRA_SSH_PRIVATE_KEY }}
          script: |
            cat > /opt/comprobify/.env <<'EOF'
            APP_ENV=${{ vars.APP_ENV }}
            APP_BASE_URL=${{ vars.APP_BASE_URL }}
            DB_HOST=${{ secrets.DB_HOST }}
            DB_PORT=${{ secrets.DB_PORT }}
            DB_NAME=${{ secrets.DB_NAME }}
            DB_USER=${{ secrets.DB_USER }}
            DB_PASSWORD=${{ secrets.DB_PASSWORD }}
            DB_SSL=${{ vars.DB_SSL }}
            ENCRYPTION_KEY=${{ secrets.ENCRYPTION_KEY }}
            ADMIN_SECRET=${{ secrets.ADMIN_SECRET }}
            EMAIL_FROM=${{ vars.EMAIL_FROM }}
            MAILGUN_API_KEY=${{ secrets.MAILGUN_API_KEY }}
            MAILGUN_DOMAIN=${{ vars.MAILGUN_DOMAIN }}
            MAILGUN_WEBHOOK_SIGNING_KEY=${{ secrets.MAILGUN_WEBHOOK_SIGNING_KEY }}
            SENTRY_DSN=${{ secrets.SENTRY_DSN }}
            BANK_TRANSFER_BANK_NAME=${{ vars.BANK_TRANSFER_BANK_NAME }}
            BANK_TRANSFER_ACCOUNT_TYPE=${{ vars.BANK_TRANSFER_ACCOUNT_TYPE }}
            BANK_TRANSFER_ACCOUNT_NUMBER=${{ vars.BANK_TRANSFER_ACCOUNT_NUMBER }}
            BANK_TRANSFER_ACCOUNT_HOLDER=${{ vars.BANK_TRANSFER_ACCOUNT_HOLDER }}
            BANK_TRANSFER_IDENTIFICATION=${{ vars.BANK_TRANSFER_IDENTIFICATION }}
            ADMIN_NOTIFICATION_EMAIL=${{ vars.ADMIN_NOTIFICATION_EMAIL }}
            OPERATOR_NAME=${{ vars.OPERATOR_NAME }}
            OPERATOR_RUC=${{ vars.OPERATOR_RUC }}
            OPERATOR_EMAIL=${{ vars.OPERATOR_EMAIL }}
            OPERATOR_ADDRESS=${{ vars.OPERATOR_ADDRESS }}
            RABBITMQ_URL=${{ secrets.RABBITMQ_URL }}
            EOF
            chmod 600 /opt/comprobify/.env
            cd /opt/comprobify
            export IMAGE_TAG=${{ github.sha }}
            # docker/login-action earlier only authenticates the runner's own daemon (so
            # it can push) - the droplet's daemon, pulling over this SSH session, needs
            # its own separate login. Reuses this job's GITHUB_TOKEN (already scoped
            # packages: write, which covers pulling too) rather than a separate long-lived
            # PAT - it's re-issued fresh every run, nothing to rotate later.
            echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
            docker compose pull
            docker compose up -d
```

`${{ secrets.* }}` and `${{ vars.* }}` are both substituted client-side by the Actions runner before the script is sent over SSH, so nothing new is exposed beyond what already sits in GitHub — SSH itself is encrypted in transit. `DROPLET_IP`/`INFRA_SSH_PRIVATE_KEY` (used to *reach* the droplet) stay as Secrets even though an IP isn't devastating if leaked — connection details to infrastructure are worth keeping to the stricter default.

Rotation, for either kind: update the value in the GitHub Environment, then trigger the deploy workflow (a push, or `workflow_dispatch`) — no manual SSH step to hand-edit a file on the droplet. The one exception is `ENCRYPTION_KEY`, which needs the careful re-encryption dance documented in `deployment.md`'s "Rotating secrets" section — that danger is about the data itself, independent of which platform hosts the app.

---

## Scheduled jobs

The 4 admin jobs (notifications, subscriptions, quota, queue-reconciliation — see `deployment.md`'s "Scheduled jobs" section for what each one actually does) previously ran as Render Cron Job services. They now run via a system `cron.d` file, written to the droplet by cloud-init:

```
# terraform/modules/droplet/cloud-init.yaml.tftpl -> /etc/cron.d/comprobify-jobs
*/5 * * * * cpfydeploy9x cd /opt/comprobify && docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/notifications 2>&1 | logger -t comprobify-cron
0 6 * * * cpfydeploy9x cd /opt/comprobify && docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/subscriptions 2>&1 | logger -t comprobify-cron
10 6 * * * cpfydeploy9x cd /opt/comprobify && docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/quota 2>&1 | logger -t comprobify-cron
*/5 * * * * cpfydeploy9x cd /opt/comprobify && docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/queue-reconciliation 2>&1 | logger -t comprobify-cron
```

**Why `docker compose exec` instead of installing Node on the droplet:** `scripts/run-admin-job.js` has zero npm dependencies — just Node's built-in `fetch` — so rather than installing Node system-wide on the bare host (one more thing to patch and keep current), the cron entries just run it *inside* the already-running `api` container, reusing the exact deployed script version. This also means it automatically picks up `ADMIN_SECRET` from that container's own `.env` — nothing extra to configure. The only env var this needs that the app itself doesn't is `API_BASE_URL` (distinct name from `APP_BASE_URL`, same value) — see the env var reference table above.

**Runs as `cpfydeploy9x`, not root** — consistent with everything else in "SSH access model" above; this account's `docker` group membership is sufficient, no elevated privileges needed.

**Harmless if it fires before the first deploy or during a redeploy** — `docker compose exec` just fails (no `api` container to exec into yet, or briefly mid-restart), logged and ignored; the next scheduled run tries again.

**Monitoring:** `journalctl -t comprobify-cron` on the droplet shows every run's output, tagged for easy filtering — replaces watching the Render Cron Job dashboard.

**If the schedule itself needs to change:** edit `cloud-init.yaml.tftpl`, then recreate the droplet (`user_data` only applies at first boot, same constraint as everything else in cloud-init — see "Day-2 operations" below). Not something you'd expect to do often.

---

## First-time setup, step by step

1. Install prerequisites (above).
2. Generate the SSH key pair; paste the public half's content (`cat` the `.pub` file) into `ssh_public_key` in `terraform.tfvars`.
3. Create the DO API token and Cloudflare API token (see Prerequisites table above for exact scopes).
4. Create the DO Spaces bucket for state (one-time, dashboard or `doctl`; Standard storage, CDN off — see "Remote state" above) and generate a Spaces key pair scoped to just that bucket. DO shows the Access Key ID and Secret Access Key together, once — capture both before closing that screen, or you'll need to regenerate.
5. In your own terminal (never paste real token/key values into a chat, commit, or anywhere outside your local shell/GitHub Secrets):
   ```bash
   cd terraform/environments/staging

   export TF_VAR_do_token="<comprobify-terraform-staging DO token>"
   export TF_VAR_cloudflare_token="<comprobify-terraform-staging Cloudflare token>"
   export AWS_ACCESS_KEY_ID="<Spaces access key>"
   export AWS_SECRET_ACCESS_KEY="<Spaces secret key>"
   ```
6. `terraform init` — downloads providers, connects to the remote state backend. If this fails with a `403 InvalidClientTokenId` / "AWS account ID not previously found" error, see the `skip_requesting_account_id` note under "Remote state" above — that's a backend config issue, not a credentials problem.
7. `terraform plan` — review what will be created. Nothing exists yet, so expect a full "create" plan for the droplet, firewall, SSH key, DNS record, and Project. **Read this output before typing yes** — it's the one moment you see exactly what's about to happen.
8. `terraform apply`, confirm with `yes`. Takes roughly a minute; droplet boots, cloud-init hardens it.
9. Verify: `terraform output` shows both `droplet_ip` (ephemeral) and `reserved_ip` (stable — use this one from here on); `ssh -i ~/.ssh/comprobify_deploy cpfydeploy9x@$(terraform output -raw reserved_ip)` connects (not `root@` — see "SSH access model" above); `dig api-staging.comprobify.com` resolves through Cloudflare once the record propagates (near-instant, since it's proxied).
10. Add the CD pipeline's secrets to the GitHub `staging` Environment (`DROPLET_IP` = the Terraform **`reserved_ip`** output — not `droplet_ip`, see "Reserved IP" above — `INFRA_SSH_PRIVATE_KEY` = the private half of the key from step 2, plus every app secret/variable from `deployment.md`'s env var table, split as above). Run the app deploy workflow once (push to `staging`, or `workflow_dispatch`) — it pushes `docker-compose.yml`/`Caddyfile`, writes `.env`, and starts the containers. No manual droplet setup step needed beyond this.
11. Repeat steps 3–10 for `environments/production` — separate state, separate apply, same module, its own droplet, its own GitHub `production` Environment secrets, its own `comprobify-terraform-production` tokens.

---

## CI/CD (GitHub Actions)

Two workflows, gated by path so neither triggers the other.

### Infra workflow — `.github/workflows/terraform.yml`

**Triggers:** a push to `main` that touches anything under `terraform/**`, or manual `workflow_dispatch`. Deliberately `main`, not `staging` — `staging` only moves when `release-staging.yml` fast-forwards it to a version tag (see "Releasing" in `CLAUDE.md`), which is the app's release cadence, not infra's. Tying this workflow to `staging` would mean an infra-only fix (a firewall rule, a droplet resize) has to wait for a full app version release before it can apply. `main` is where infra PRs are actually reviewed and merged, so that review — plus the `staging-infra` Environment approval on `plan`/`apply` above — is the real gate, independent of whether an app release happens to be in flight.

**This does not create or destroy the droplet on every push.** `terraform apply` is idempotent — it diffs the `.tf`/`.tftpl` files against the last-applied state and only touches what actually changed. A `terraform/**` push that doesn't alter any resource's configuration (a comment, a doc reference inside a `.tf` file) produces a "no changes" plan and applies nothing.

**One real exception: a few resource attributes are Terraform "ForceNew," meaning a change destroys and recreates the droplet instead of updating it in place** — `user_data` (the cloud-init script, so any edit to `cloud-init.yaml.tftpl`) and the SSH key's `public_key` (see "Rotating the SSH key" under Day-2 operations, which walks through this exact replacement manually). Pushing a `cloud-init.yaml.tftpl` change to `main` will make the next CI `apply` tear down and rebuild the running droplet — everything reprovisioned from scratch — and the app still needs redeploying afterward, same as after a manual `terraform destroy`/`apply` cycle. Thanks to the Reserved IP (see above), this no longer changes the public address the droplet is reachable at, so `DROPLET_IP` and DNS stay untouched across the replacement. Always read the `plan` job's output for "must be replaced" before approving `apply` on a change touching this file.

**This replacement happens automatically inside `apply` — `terraform destroy` is never needed for it.** `destroy` is a distinct, explicit command with no recreate step (that's what "Destroy staging once you're done testing" below is for). A ForceNew attribute change just makes the plan mark that one resource `-/+ must be replaced`; `apply` performs the destroy-then-create for it as a single atomic step, same run, no separate command.

Full file lives in the repo. Three more design points worth calling out, all easy to get wrong:

**`DO_TOKEN`/`CLOUDFLARE_TOKEN` live in the `staging-infra` GitHub Environment (Settings → Environments → `staging-infra` → Environment secrets), unprefixed — same convention `deploy-staging.yml` already uses for `DB_HOST`/`ADMIN_SECRET`/etc: one secret name, a different value per Environment, not a name per environment.** The `comprobify-terraform-staging` and `comprobify-terraform-production` credentials (see the Prerequisites table above) are deliberately separate tokens, never shared, so a leaked staging credential can be revoked without touching production — `staging-infra` holds the staging value, and the not-yet-created `production-infra` Environment will hold the production value under the exact same secret names once that job pair exists.

**Both `plan` and `apply` declare `environment: staging-infra`.** GitHub only grants a job access to an Environment's secrets if that job declares it — which also means that Environment's protection rules (like a required reviewer) apply to that job too. Declaring it on both jobs means adding a required reviewer to `staging-infra` later would gate `plan` as well as `apply`: you'd approve *before* seeing the plan's diff, not after reading it. This was a deliberate trade-off in favor of staying consistent with `deploy-staging.yml`'s single-environment shape, rather than introducing a second, plan-only Environment just to keep `plan` ungated.

**The Spaces state-backend credentials (`TERRAFORM_SPACES_ACCESS_KEY_ID`/`TERRAFORM_SPACES_SECRET_ACCESS_KEY`) are the one exception and stay as plain repository secrets, not Environment secrets.** Staging and production share one state bucket with different key prefixes (see "Remote state" above) via one Spaces key pair created once — there's only ever one correct value, and every job needs it regardless of which Environment it declares. They keep the `TERRAFORM_` prefix because, as repository secrets, they sit in the same flat Secrets list as `docs.yml`'s unrelated `DOCS_CLOUDFLARE_API_TOKEN`/`DOCS_CLOUDFLARE_ACCOUNT_ID` pair — Environment secrets don't have that collision risk, since they're scoped to their own Environment's page in the GitHub UI, which is why `DO_TOKEN`/`CLOUDFLARE_TOKEN` don't need a prefix.

```yaml
on:
  push:
    branches: [main]
    paths: ['terraform/**']
  workflow_dispatch: {}

jobs:
  plan:
    runs-on: ubuntu-latest
    environment: staging-infra
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5
      - run: terraform -chdir=terraform/environments/staging init
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.TERRAFORM_SPACES_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.TERRAFORM_SPACES_SECRET_ACCESS_KEY }}
      - run: terraform -chdir=terraform/environments/staging plan
        env:
          TF_VAR_do_token: ${{ secrets.DO_TOKEN }}
          TF_VAR_cloudflare_token: ${{ secrets.CLOUDFLARE_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.TERRAFORM_SPACES_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.TERRAFORM_SPACES_SECRET_ACCESS_KEY }}

  apply:
    needs: plan
    environment: staging-infra
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5
      - run: terraform -chdir=terraform/environments/staging init
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.TERRAFORM_SPACES_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.TERRAFORM_SPACES_SECRET_ACCESS_KEY }}
      - run: terraform -chdir=terraform/environments/staging apply -auto-approve
        env:
          TF_VAR_do_token: ${{ secrets.DO_TOKEN }}
          TF_VAR_cloudflare_token: ${{ secrets.CLOUDFLARE_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.TERRAFORM_SPACES_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.TERRAFORM_SPACES_SECRET_ACCESS_KEY }}
```

Note both `init` steps also need the Spaces credentials, not just `plan`/`apply` — `init` is what actually connects to the remote state backend.

Production's equivalent pair doesn't exist yet — add it once `terraform/environments/production` does, pointed at that directory, with both jobs declaring `environment: production-infra` and reading the same `DO_TOKEN`/`CLOUDFLARE_TOKEN` names from that Environment (its own distinct values — see above) plus the same shared `TERRAFORM_SPACES_*` repository secrets. Add a required reviewer to `production-infra` for a deliberate, auditable approval gate before anything touches production infrastructure — separate from whatever Environment `deploy-production.yml` ends up using for app secrets.

### App deploy workflow — `.github/workflows/deploy-staging.yml`

Full file lives in the repo; the shape is checkout → build/push the image to GHCR → SCP the compose files → SSH in (as `cpfydeploy9x`, not root — see "SSH access model" above) to write `.env` and restart containers. No firewall dance needed — SSH is open, so the runner just connects directly, same as the Terraform-managed pieces below it in the module. An earlier version of this workflow briefly added/removed a just-in-time firewall rule per deploy instead of relying on open SSH; see "SSH access model" for why that approach was tried and then abandoned.

The `production` equivalent triggers on push to the `production` branch, matching the same branch/tag/release pipeline documented in `deployment.md`.

---

## Day-2 operations

**Destroy staging once you're done testing for the day/week:**
```bash
cd terraform/environments/staging
terraform destroy
```
Billing stops immediately, prorated to the hour actually used. `terraform destroy` also tears down the reserved IP and its assignment along with everything else Terraform manages for this environment (they're state-tracked resources like any other) — a `destroy` really means "nothing left," not just "droplet gone." The Cloudflare DNS record goes with it too (it's Terraform-managed) — no dangling record pointing at a dead IP.

**Recreate it:**
```bash
terraform apply
```
New droplet (new *ephemeral* IP, `droplet_ip` output), but the reserved IP is recreated fresh too since `destroy` removed it — so this is the one case where DNS and `DROPLET_IP` genuinely do need updating again afterward, same as before the reserved IP existed. `terraform output reserved_ip` gives the new value; the Cloudflare record updates automatically in the same `apply` since it references that output.

The new droplet has Docker installed (from the image) but nothing running yet — `docker-compose.yml`, `Caddyfile`, and `.env` all live only in GitHub/the CD pipeline, never on disk outside a running droplet (see "The application stack" above), so there's nothing to lose on destroy. Update `DROPLET_IP` (`gh secret set DROPLET_IP --env staging --repo novaej/comprobify --body "$(terraform output -raw reserved_ip)"`), then re-run the app deploy workflow (`workflow_dispatch`, or push an empty commit) against the new droplet — it pushes the compose files, writes `.env` fresh from the current GitHub secrets, and starts the containers.

**A `terraform apply` that merely *replaces* the droplet — without a preceding `destroy`** (the ForceNew cases: editing `cloud-init.yaml.tftpl`, or the SSH key rotation below) **does not** hit this — the reserved IP and its assignment aren't touched, only re-pointed at the new droplet id in the same `apply`, so `DROPLET_IP`/DNS stay exactly as they were. This distinction — explicit `destroy`+`apply` vs. an in-place `apply` that replaces just the droplet — is the whole reason the reserved IP is worth having.

**Resize:**
Change `droplet_size` in `terraform.tfvars`, `terraform plan` to confirm it shows an in-place resize (DO supports live resizing for most size changes — the plan output will tell you if a particular change instead requires destroy/recreate), then `terraform apply`.

**Rotating the SSH key:**

The key is baked into `user_data` at first boot (via the `users:` block in cloud-init — see "SSH access model" above), and `user_data` can only be set when a droplet is created, not changed on a running one. So rotating the key always means recreating the droplet — there's no in-place "swap the key" path. Since a recreate is already required, this is also a reasonable moment to do it if you're not rotating for any specific urgent reason (e.g. suspected key exposure) — no need to wait for one.

1. Generate a new pair, with a name that won't collide with the old one:
   ```bash
   ssh-keygen -t ed25519 -C "comprobify-deploy" -f ~/.ssh/comprobify_deploy_new
   ```
2. Put its public half's content into `terraform.tfvars`:
   ```hcl
   ssh_public_key = "ssh-ed25519 AAAA... comprobify-deploy"   # cat ~/.ssh/comprobify_deploy_new.pub
   ```
3. `terraform plan` — expect it to show both `digitalocean_ssh_key.infra` (replaced — DO's API treats a key's `public_key` as immutable, so a change forces a new resource, and Terraform deletes the old one from your DO account automatically as part of that) and `digitalocean_droplet.this` (replaced, since `user_data` changed) needing replacement, plus `digitalocean_reserved_ip_assignment.this` updating to point at the new droplet id (in-place update, not a replacement) and everything else downstream (firewall, project assignment) updating to reference the new droplet. `digitalocean_reserved_ip.this` itself should show **no change** — that's the reserved IP doing its job.
4. `terraform apply`, confirm with `yes`.
5. Verify the new key actually works before touching anything else — against the reserved IP, which already points at the new droplet by the time `apply` finishes:
   ```bash
   ssh -i ~/.ssh/comprobify_deploy_new cpfydeploy9x@$(terraform output -raw reserved_ip)
   ```
6. Update the one GitHub value this affects — just the SSH key; `DROPLET_IP` doesn't change, since the reserved IP survived the replacement:
   ```bash
   gh secret set INFRA_SSH_PRIVATE_KEY --env staging --repo novaej/comprobify < ~/.ssh/comprobify_deploy_new
   ```
7. Trigger a deploy (`workflow_dispatch`, or push to `staging`) to confirm the CD pipeline works end-to-end with the new key before considering this done.
8. Only now, with everything confirmed working, clean up the old key — it's no longer referenced by Terraform state, GitHub, or the (now-destroyed) old droplet, so there's nothing left depending on it:
   ```bash
   rm ~/.ssh/comprobify_infra ~/.ssh/comprobify_infra.pub   # or whatever the old pair was named
   ```
   Then, if you'd rather not keep the "_new" suffix permanently, rename the current pair (`mv ~/.ssh/comprobify_deploy_new ~/.ssh/comprobify_deploy` and the `.pub` alongside it) — no `terraform.tfvars` change needed for this part, since it holds the key's *content*, not a path, and a local rename doesn't touch that.

Steps 5 and 7 are both worth doing before step 8 specifically — deleting the old key before confirming the new one works end to end (both for interactive access and for CI) is how you'd end up locked out with no way back except the DO Console.

---

## What's intentionally still manual

- Adding a brand-new GitHub Environment secret/variable for the first time (e.g. onboarding a new env var) — a one-time UI step; the CD workflow's script only picks up entries already wired into its `.env` heredoc.
- The DO Spaces bucket used for state storage (chicken-and-egg, can't self-manage).
- `ENCRYPTION_KEY` rotation — see `deployment.md`'s "Rotating secrets" section; this is about the data, not the hosting platform.
