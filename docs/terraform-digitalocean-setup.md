# Terraform + DigitalOcean — Infrastructure Setup

Reference for how the API/worker compute layer is provisioned and deployed on DigitalOcean: droplets managed by Terraform, application code deployed via a separate GitHub Actions CI/CD pipeline. This is the living "how does our infrastructure actually work" document — for the one-time process of moving off a previous host, see `docs/deployment-digitalocean.md`.

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
| **DO Cloud Firewall** | Network-level firewall, managed by DO outside the droplet itself | Controls which IPs/ports can reach the droplet at all — the 80/443-restricted-to-Cloudflare and 22-restricted-to-your-IP rules. Distinct from a host-level firewall like `ufw`, which we deliberately don't run (checked and confirmed inactive) — this is the one and only line of defense at the network level. |
| **Cloudflare** | DNS + reverse proxy/CDN service | Owns the domain's DNS (which IP `api-staging.comprobify.com` resolves to) and proxies all public traffic, so clients never see the droplet's real IP directly — also gives free DDoS/WAF protection in front of it. |
| **cloud-init** | Standard first-boot configuration tool, supported by most cloud providers | Runs once, automatically, the very first time a droplet boots — reads the `user_data` Terraform hands it and executes it. Ours installs Docker, hardens SSH, and starts `fail2ban`. Never runs again after that first boot, even across reboots. |
| **Docker** | Container runtime | Runs the app as an isolated "container" — a packaged unit with everything the app needs to run, independent of whatever else is on the machine. |
| **Docker Compose** | Tool for running multiple containers together as one unit | Defines `api`, `worker`, and `caddy` as one coordinated stack in `deploy/docker-compose.yml` — one command (`docker compose up -d`) starts/updates all three together. |
| **Caddy** | Web server / reverse proxy | The only container with ports actually exposed to the internet (80/443). Forwards incoming requests to the `api` container internally, and automatically obtains/renews the HTTPS certificate with zero manual config. |
| **fail2ban** | Intrusion-prevention tool | Watches for repeated failed SSH login attempts and temporarily bans the offending IP at the firewall level — protects against brute-force attacks even though we also restrict SSH by source IP. |
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
| SSH key pair, dedicated to this infra | Generate one below — don't reuse a personal key | Droplet access, referenced by Terraform |
| DO Spaces access key, scoped to the state bucket only | DO dashboard → API → Spaces Keys | Terraform remote state backend |

```bash
ssh-keygen -t ed25519 -C "comprobify-infra" -f ~/.ssh/comprobify_infra
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
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "digitalocean_droplet" "this" {
  name      = "comprobify-${var.environment}"
  region    = var.region             # e.g. "nyc3"
  size      = var.droplet_size       # e.g. "s-1vcpu-512mb-10gb" — the $4/mo tier, staging
  image     = var.image_slug         # plain base OS image — see note below
  ssh_keys  = [digitalocean_ssh_key.infra.id]
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    environment = var.environment
  })
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
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.admin_ip_cidr]   # your own IP — update if it changes
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
  content = digitalocean_droplet.this.ipv4_address
  proxied = true
  ttl     = 1                      # required to be 1 ("automatic") when proxied = true
}
```

The DNS record's `content` referencing `digitalocean_droplet.this.ipv4_address` is what makes destroy/recreate cycles (see Day-2 operations below) update DNS automatically in the same `apply` — no manual step, no stale record.

### Base image — plain OS, not a Marketplace app image

`image_slug` defaults to `ubuntu-24-04-x64`, a plain DigitalOcean distribution image — deliberately **not** DO's Marketplace "Docker on Ubuntu" one-click image. That was the original plan, but it doesn't fit the cheapest droplet tiers: several Marketplace app images (including the Docker one) require more disk than the $4/mo tier's 10GB provides, and `digitalocean_droplet` creation fails outright with `Cannot create a droplet with a smaller disk than the image` if you try. A plain distribution image has a much smaller footprint and fits comfortably, so Docker is installed by cloud-init instead (next section) — same end state, no forced upgrade to a pricier tier just to get Docker preinstalled.

### cloud-init (first boot only — hardening + installing Docker)

```yaml
#cloud-config
write_files:
  - path: /etc/comprobify-environment
    content: |
      ${environment}
  # Pinned to "noble" (Ubuntu 24.04) since image_slug is fixed to ubuntu-24-04-x64 -
  # update both together if the base image ever changes.
  - path: /etc/apt/sources.list.d/docker.list
    content: |
      deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable

runcmd:
  - mkdir -p /opt/comprobify
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
  - systemctl enable --now fail2ban
  - dpkg-reconfigure -f noninteractive unattended-upgrades
  - sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
  - sed -i 's/#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  - systemctl restart sshd
  - systemctl enable --now docker
```

**Keep this file strictly ASCII — no em-dashes, curly quotes, or other multi-byte characters, even in comments.** A single em-dash in a comment here once caused cloud-init to reject the *entire* `user_data` with `Failed loading yaml blob: unacceptable character #x0080`, silently falling back to an empty config — `cloud-init status` still reported `done` (nothing failed, because nothing ran: not `write_files`, not `runcmd`, not even `mkdir -p /opt/comprobify`, the very first command). The droplet came up looking healthy while doing none of the setup it was supposed to. `extended_status: degraded done` (visible via `cloud-init status --long`, not the plain `cloud-init status`) is the tell — check that field first if a freshly-created droplet is missing anything cloud-init was supposed to set up. Before trusting a `.tftpl` edit here, verify it's pure ASCII:
```bash
grep -n -P '[^\x00-\x7F]' terraform/modules/droplet/cloud-init.yaml.tftpl
```
No output means clean.

**All package installation deliberately lives in `runcmd`, not cloud-init's `package_update`/`packages` directives.** An earlier version used those directives for `fail2ban`/`unattended-upgrades`/`ca-certificates`/`curl`, and hit a second, separate `degraded done` cause: `apt-get update` exit code 100 from apt/dpkg lock contention with Ubuntu's background `apt-daily` timer racing it right after boot. That specific run didn't actually lose anything (the base image's package index happened to be fresh enough that later installs succeeded anyway, confirmed by checking `fail2ban`'s status and `dpkg -l` directly) — but that was luck, not a guarantee the next base image or timing would repeat it. `DPkg::Lock::Timeout=120` on every `apt-get` call here means a lock held by `apt-daily` gets waited out for up to two minutes instead of failing the command outright, which cloud-init's own package module can't be configured to do.

Deliberately does **not** set up the app's `docker-compose.yml` or secrets — only the empty target directory. Everything inside it is pushed by the CD pipeline, covered next. Terraform's job ends at "droplet exists, hardened, Docker installed, directory ready."

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

### Env vars — secrets vs. plain config

Not every required env var is actually a *secret*. GitHub Actions has two separate per-Environment stores:

- **Secrets** — encrypted, write-only after saving (you can overwrite but never view the value again in the UI), masked as `***` in workflow logs. Use for anything credential-shaped.
- **Variables** (`vars` context) — plain text, visible and editable in the UI, shown unmasked in logs. Use for everything else — there's no benefit to hiding a value like `APP_ENV=staging`, and a real cost: you can't glance at or tweak a Secret without re-typing it blind.

Split, using `docs/deployment.md`'s "Environment variables" table as the canonical list of what the application needs:

| GitHub **Secrets** | GitHub **Variables** |
|---|---|
| `ENCRYPTION_KEY` | `APP_ENV` |
| `ADMIN_SECRET` | `APP_BASE_URL` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` (kept together as one group for simplicity, even though a couple of them aren't sensitive alone) | `PORT`, `DB_SSL` |
| `MAILGUN_API_KEY` | `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_FROM_DOCUMENTS`, `MAILGUN_DOMAIN` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | — |
| `RABBITMQ_URL` (embeds credentials) | `RABBITMQ_SRI_EXCHANGE` |
| `SENTRY_DSN` (not catastrophic if leaked, but conventionally kept private — a leaked DSN lets someone spam fake events into your project) | `VERIFICATION_TOKEN_TTL_HOURS`, all four `QUEUE_RECONCILE_*` tuning knobs |
| — | `BANK_TRANSFER_BANK_NAME` / `ACCOUNT_TYPE` / `ACCOUNT_NUMBER` / `ACCOUNT_HOLDER` / `IDENTIFICATION` — `deployment.md` already calls these "Display text only, not a secret" |

Both stores are scoped per GitHub Environment (`staging`/`production`) — one place per environment, two tabs (Secrets / Variables) within it.

On every deploy, the CD workflow's SSH step writes the full set into `/opt/comprobify/.env` on the droplet — overwritten each run, so the file always reflects whatever's currently in GitHub:

```yaml
      - uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.STAGING_DROPLET_IP }}
          username: root
          key: ${{ secrets.INFRA_SSH_PRIVATE_KEY }}
          source: "deploy/docker-compose.yml,deploy/Caddyfile"
          target: /opt/comprobify
          strip_components: 1

      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.STAGING_DROPLET_IP }}
          username: root
          key: ${{ secrets.INFRA_SSH_PRIVATE_KEY }}
          script: |
            cat > /opt/comprobify/.env <<'EOF'
            APP_ENV=${{ vars.APP_ENV }}
            PORT=${{ vars.PORT }}
            APP_BASE_URL=${{ vars.APP_BASE_URL }}
            VERIFICATION_TOKEN_TTL_HOURS=${{ vars.VERIFICATION_TOKEN_TTL_HOURS }}
            DB_HOST=${{ secrets.DB_HOST }}
            DB_PORT=${{ secrets.DB_PORT }}
            DB_NAME=${{ secrets.DB_NAME }}
            DB_USER=${{ secrets.DB_USER }}
            DB_PASSWORD=${{ secrets.DB_PASSWORD }}
            DB_SSL=${{ vars.DB_SSL }}
            ENCRYPTION_KEY=${{ secrets.ENCRYPTION_KEY }}
            ADMIN_SECRET=${{ secrets.ADMIN_SECRET }}
            EMAIL_PROVIDER=${{ vars.EMAIL_PROVIDER }}
            EMAIL_FROM=${{ vars.EMAIL_FROM }}
            EMAIL_FROM_DOCUMENTS=${{ vars.EMAIL_FROM_DOCUMENTS }}
            MAILGUN_API_KEY=${{ secrets.MAILGUN_API_KEY }}
            MAILGUN_DOMAIN=${{ vars.MAILGUN_DOMAIN }}
            MAILGUN_WEBHOOK_SIGNING_KEY=${{ secrets.MAILGUN_WEBHOOK_SIGNING_KEY }}
            SENTRY_DSN=${{ secrets.SENTRY_DSN }}
            BANK_TRANSFER_BANK_NAME=${{ vars.BANK_TRANSFER_BANK_NAME }}
            BANK_TRANSFER_ACCOUNT_TYPE=${{ vars.BANK_TRANSFER_ACCOUNT_TYPE }}
            BANK_TRANSFER_ACCOUNT_NUMBER=${{ vars.BANK_TRANSFER_ACCOUNT_NUMBER }}
            BANK_TRANSFER_ACCOUNT_HOLDER=${{ vars.BANK_TRANSFER_ACCOUNT_HOLDER }}
            BANK_TRANSFER_IDENTIFICATION=${{ vars.BANK_TRANSFER_IDENTIFICATION }}
            RABBITMQ_URL=${{ secrets.RABBITMQ_URL }}
            RABBITMQ_SRI_EXCHANGE=${{ vars.RABBITMQ_SRI_EXCHANGE }}
            QUEUE_RECONCILE_SEND_STALE_MINUTES=${{ vars.QUEUE_RECONCILE_SEND_STALE_MINUTES }}
            QUEUE_RECONCILE_AUTHORIZE_DELAY_MINUTES=${{ vars.QUEUE_RECONCILE_AUTHORIZE_DELAY_MINUTES }}
            QUEUE_RECONCILE_AUTHORIZE_STALE_MINUTES=${{ vars.QUEUE_RECONCILE_AUTHORIZE_STALE_MINUTES }}
            QUEUE_RECONCILE_BATCH_LIMIT=${{ vars.QUEUE_RECONCILE_BATCH_LIMIT }}
            EOF
            chmod 600 /opt/comprobify/.env
            cd /opt/comprobify
            export IMAGE_TAG=${{ github.sha }}
            docker compose pull
            docker compose up -d
```

`${{ secrets.* }}` and `${{ vars.* }}` are both substituted client-side by the Actions runner before the script is sent over SSH, so nothing new is exposed beyond what already sits in GitHub — SSH itself is encrypted in transit. `STAGING_DROPLET_IP`/`INFRA_SSH_PRIVATE_KEY` (used to *reach* the droplet) stay as Secrets even though an IP isn't devastating if leaked — connection details to infrastructure are worth keeping to the stricter default.

Rotation, for either kind: update the value in the GitHub Environment, then trigger the deploy workflow (a push, or `workflow_dispatch`) — no manual SSH step to hand-edit a file on the droplet. The one exception is `ENCRYPTION_KEY`, which needs the careful re-encryption dance documented in `deployment.md`'s "Rotating secrets" section — that danger is about the data itself, independent of which platform hosts the app.

---

## First-time setup, step by step

1. Install prerequisites (above).
2. Generate the SSH key pair; note its public key path for `terraform.tfvars`.
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
9. Verify: `terraform output` shows the new IP; `ssh -i ~/.ssh/comprobify_infra root@<ip>` connects; `dig api-staging.comprobify.com` resolves through Cloudflare once the record propagates (near-instant, since it's proxied).
10. Add the CD pipeline's secrets to the GitHub `staging` Environment (`STAGING_DROPLET_IP` = the Terraform output IP, `INFRA_SSH_PRIVATE_KEY` = the private half of the key from step 2, plus every app secret/variable from `deployment.md`'s env var table, split as above). Run the app deploy workflow once (push to `staging`, or `workflow_dispatch`) — it pushes `docker-compose.yml`/`Caddyfile`, writes `.env`, and starts the containers. No manual droplet setup step needed beyond this.
11. Repeat steps 3–10 for `environments/production` — separate state, separate apply, same module, its own droplet, its own GitHub `production` Environment secrets, its own `comprobify-terraform-production` tokens.

---

## CI/CD (GitHub Actions)

Two workflows, gated by path so neither triggers the other.

### Infra workflow — `.github/workflows/terraform.yml`

```yaml
on:
  push:
    branches: [main]
    paths: ['terraform/**']
  workflow_dispatch: {}

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5
      - run: terraform -chdir=terraform/environments/staging init
      - run: terraform -chdir=terraform/environments/staging plan
        env:
          TF_VAR_do_token: ${{ secrets.DO_TOKEN }}
          TF_VAR_cloudflare_token: ${{ secrets.CLOUDFLARE_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.SPACES_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.SPACES_SECRET_ACCESS_KEY }}

  apply:
    needs: plan
    environment: staging   # add a required reviewer here for production's equivalent job
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5
      - run: terraform -chdir=terraform/environments/staging init
      - run: terraform -chdir=terraform/environments/staging apply -auto-approve
        env:
          TF_VAR_do_token: ${{ secrets.DO_TOKEN }}
          TF_VAR_cloudflare_token: ${{ secrets.CLOUDFLARE_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.SPACES_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.SPACES_SECRET_ACCESS_KEY }}
```

Production gets a near-identical second `plan`/`apply` pair pointed at `environments/production`, with the `apply` job's `environment: production` gated behind a required reviewer — a deliberate, auditable approval gate before anything touches production infrastructure.

### App deploy workflow — `.github/workflows/deploy-staging.yml`

```yaml
on:
  push:
    branches: [staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: |
          docker build -t ghcr.io/${{ github.repository }}:${{ github.sha }} .
          docker push ghcr.io/${{ github.repository }}:${{ github.sha }}
      # ...then the scp + ssh steps shown in "The application stack" section above
      # (push docker-compose.yml/Caddyfile, write .env from GitHub secrets, pull + up -d)
```

The `production` equivalent triggers on push to the `production` branch, matching the same branch/tag/release pipeline documented in `deployment.md`.

---

## Day-2 operations

**Destroy staging once you're done testing for the day/week:**
```bash
cd terraform/environments/staging
terraform destroy
```
Billing stops immediately, prorated to the hour actually used. The Cloudflare DNS record is destroyed with it (it's Terraform-managed) — no dangling record pointing at a dead IP.

**Recreate it:**
```bash
terraform apply
```
New droplet, new IP, DNS record automatically re-pointed at the new IP within the same apply — no manual DNS step, no propagation delay to worry about since the record is Cloudflare-proxied.

The new droplet has Docker installed (from the image) but nothing running yet — `docker-compose.yml`, `Caddyfile`, and `.env` all live only in GitHub/the CD pipeline, never on disk outside a running droplet (see "The application stack" above), so there's nothing to lose on destroy. Just re-run the app deploy workflow (`workflow_dispatch`, or push an empty commit) against the new droplet once `terraform apply` finishes — it pushes the compose files, writes `.env` fresh from the current GitHub secrets, and starts the containers. Recreate is genuinely two commands: `terraform apply` then a deploy trigger.

**Update `STAGING_DROPLET_IP` before that deploy trigger, though — this step is easy to forget.** Terraform and GitHub Secrets are two completely separate systems with nothing syncing them automatically, so a new droplet's IP has to be pushed to GitHub by hand or the deploy workflow will SSH/SCP to the *old*, now-nonexistent IP and fail:
```bash
gh secret set STAGING_DROPLET_IP --env staging --repo novaej/comprobify
# paste the value from `terraform output droplet_ip` when prompted
```
(A fancier version of this — the Terraform CI workflow auto-pushing the new IP via the GitHub API right after `apply` — is possible, but not worth building until Terraform itself runs in CI rather than locally.)

**Resize:**
Change `droplet_size` in `terraform.tfvars`, `terraform plan` to confirm it shows an in-place resize (DO supports live resizing for most size changes — the plan output will tell you if a particular change instead requires destroy/recreate), then `terraform apply`.

**Rotate the SSH key:**
Point `ssh_public_key_path` at the new key, `terraform apply` — updates the `digitalocean_ssh_key` resource, but existing droplets need a manual `authorized_keys` update too, since SSH keys are only injected at *first* boot via cloud-init, not re-pushed on every apply.

**When `admin_ip_cidr` stops matching:**
The SSH firewall rule is scoped to a single `/32` — your own public IP — on the reasoning that key-only auth + `fail2ban` is good defense, but a second, narrower layer (only one IP can even attempt to connect) is worth the small maintenance cost of updating it occasionally. If SSH suddenly times out with no response at all (not a refusal — a silent drop), first re-check `curl -s ifconfig.me` against the current value in `terraform.tfvars`. If they match and the DO dashboard confirms the firewall rule is correct with no pending changes, the likely cause is CGNAT (Carrier-Grade NAT) — some ISPs route different outbound connections through different public IPs from a shared pool, so the IP a checker reports isn't guaranteed to be the exact IP DigitalOcean's firewall sees for a *different* connection moments later.

This is a real tradeoff to make deliberately, not something to change without discussing it first: tightening to a `/32` gives a genuine extra layer, but on a network where the outbound IP can't be reliably captured, it may cause SSH to silently fail even when correctly configured. If that happens, the options are (a) find the ISP's actual allocated netblock via a WHOIS/RDAP lookup on the reported IP and scope to that wider-but-still-bounded range instead of the internet at large, or (b) accept `0.0.0.0/0` and rely on key-only auth + `fail2ban` alone. Either way, DigitalOcean's dashboard has a browser-based Droplet Console as a fallback if you ever do get locked out (Droplet → Access → Launch Droplet Console) — it doesn't route through the same network path as SSH.

---

## What's intentionally still manual

- Adding a brand-new GitHub Environment secret/variable for the first time (e.g. onboarding a new env var) — a one-time UI step; the CD workflow's script only picks up entries already wired into its `.env` heredoc.
- The DO Spaces bucket used for state storage (chicken-and-egg, can't self-manage).
- `ENCRYPTION_KEY` rotation — see `deployment.md`'s "Rotating secrets" section; this is about the data, not the hosting platform.
