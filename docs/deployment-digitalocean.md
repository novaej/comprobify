# Migrating from Render to DigitalOcean

The one-time process of moving the API/worker/cron compute layer off Render onto DigitalOcean, provisioned via Terraform. For how the DO/Terraform setup actually works day to day — the module, the compose stack, CI/CD, secrets, day-2 ops — see `docs/terraform-digitalocean-setup.md`. This file only covers what's specific to the *migration itself*.

**What this replaces:** Render's API web service, the `comprobify-staging-worker` Background Worker, and the 4 Render Cron Jobs.

**What stays exactly as-is — do not touch:** Neon (Postgres), CloudAMQP (RabbitMQ), Mailgun, Sentry, and Cloudflare as registrar/DNS/proxy (only the DNS record's *target* changes, from Render's hostname to the droplet's IP). Vercel/`comprobify-web` is entirely out of scope.

---

## Migration checklist

Staging is live on Render today; production has never been provisioned there at all (per `deployment.md`'s "Production status" — its pipeline is written but disabled). That means production has zero cutover risk — it's first-time provisioning, not a migration. Staging needs care:

- [ ] Provision the DO droplet for staging via Terraform (`docs/terraform-digitalocean-setup.md`); confirm the app boots and `/health` passes
- [ ] Point a **temporary** subdomain (not `api-staging.comprobify.com` yet) at it and run a full smoke test in isolation
- [ ] Cut the real Cloudflare DNS record for `api-staging.comprobify.com` over to the DO droplet
- [ ] Add the new GitHub Actions secrets (`STAGING_DROPLET_IP`, `INFRA_SSH_PRIVATE_KEY`, `DO_TOKEN`, `CLOUDFLARE_TOKEN`, `SPACES_ACCESS_KEY_ID`/`SECRET`) and remove `RENDER_DEPLOY_HOOK_URL`
- [ ] Suspend (don't delete) the Render staging service for a few days as a rollback option
- [ ] Once confident, delete the Render staging service, its 3 cron jobs, and its worker; remove `render.yaml` from the repo
- [ ] Provision `environments/production` for the first time (no Render equivalent to retire)
- [ ] Update `docs/deployment.md` to point at `docs/terraform-digitalocean-setup.md` / DO as the deploy target instead of Render throughout
