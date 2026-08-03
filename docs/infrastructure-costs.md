# Infrastructure Costs — Production

Production platform decisions and the real cost baseline behind the subscription tier pricing in `src/constants/subscription-tiers.js`. Staging's stack is documented separately in `architecture-staging.drawio` / `docs/terraform-digitalocean-setup.md`; this file is production-only.

**Platform note:** staging moved from Render to a DigitalOcean droplet (see `docs/terraform-digitalocean-setup.md`), consolidated its database from Neon onto a shared DigitalOcean Managed Postgres cluster, and consolidated comprobify-web's hosting from Vercel onto DigitalOcean App Platform — see `docs/deployment-reference-staging.md` and comprobify-web's own `docs/deployment.md`. Production, still on standby, is planned to follow the same fully-DigitalOcean model rather than reviving the old Render/Neon/Vercel mix — the numbers below reflect that plan, with the one line item (droplet size) still an open decision flagged explicitly, not silently guessed.

---

## Stack

| Layer | Platform | Role |
|---|---|---|
| API + worker + scheduled jobs | DigitalOcean Droplet (Terraform-managed) | One droplet running Caddy, `api`, and `worker` as separate containers, plus a `cron.d` schedule for the 4 admin jobs — see `docs/terraform-digitalocean-setup.md`. Consolidates what would have been 3 separate Render line items (web service, background worker, cron jobs) into one compute cost. |
| Database | DigitalOcean Managed Postgres (single shared cluster) | The API's `public` + `sandbox` schemas and comprobify-web's own schema live on one cluster, mirroring staging's setup — grouped into the same DO Project as the droplet for dashboard purposes only, not provisioned by this repo's Terraform. See "One shared cluster" below for why there's no separate frontend-database line item. |
| State storage | DigitalOcean Spaces | Terraform remote state only (staging and production share the same bucket, different key prefix) — effectively $0 marginal cost for production, since staging already funds the account-level minimum |
| Frontend | DigitalOcean App Platform | comprobify-web (Next.js) — Autodeploy on push, no separate deploy workflow needed (see comprobify-web's `docs/deployment.md`) |
| Email | Mailgun (Foundation, 50k sends) | Transactional email + delivery webhooks |
| Error monitoring | Sentry | 5xx tracking |
| Rate-limit store | Redis, self-hosted container on the droplet (`deploy/docker-compose.yml`'s `redis` service) | Backs `src/middleware/rate-limit.js`'s shared store (`src/services/redis.service.js`) so every `api` instance enforces one counter per key instead of counting independently — load-bearing once the API runs more than one instance (still just one today). Chosen over a managed provider (Upstash) since it only needs to be reachable by `api` replicas on the *same* droplet — the near-term scaling plan is Compose replicas on one droplet before ever provisioning a second one. See [ADR-026](adr/026-redis-shared-counter-store.md) for the full reasoning, including what changes if that scaling plan ever moves to multiple droplets. |
| DNS | Cloudflare (free) | `api.comprobify.com` |
| CI/CD | GitHub + GitHub Actions (free tier) | |

---

## Why cron.d on the droplet instead of a separate scheduler

Same reasoning that applied to Render Cron Job over cron-job.org still holds, just running somewhere different now: a third-party scheduler with no SLA calling a Bearer-protected admin endpoint is a worse dependency than triggering the jobs from infrastructure you already control. The meaningful change from the Render era is cost, not design — a `cron.d` entry on a droplet you're already paying for costs nothing extra at all, not even the fractions-of-a-cent-per-run Render Cron Job billed. See `docs/terraform-digitalocean-setup.md`'s "Scheduled jobs" section for the actual mechanics (`docker compose exec` into the `api` container, no separate service).

---

## DigitalOcean Managed Postgres: one shared cluster, not per-service databases

Unlike Neon (usage-billed per project — CU-hours + storage, so running a second project for the frontend only added incremental compute), DigitalOcean Managed Postgres bills a **fixed price per cluster tier**, independent of how many logical databases or schemas run on it. There's therefore no cost reason to split the API and comprobify-web onto separate clusters — production is planned to mirror staging's single shared cluster: the API's `public`/`sandbox` schemas and comprobify-web's own schema all live on one cluster, with each app capping its own client-side connection pool (`DB_POOL_MAX` for the API/worker, `connection_limit` on comprobify-web's `DATABASE_URL`) since the cluster has no PgBouncer or other pooler in front of it — see `docs/deployment-reference-staging.md` and comprobify-web's `docs/deployment.md` ("DATABASE_URL connection budget on a shared cluster") for the connection-budget mechanics. This is also why the cost table below has one database line item instead of two.

---

## Monthly cost — floor (current low-load reality)

| Item | Cost |
|---|---|
| DigitalOcean Droplet (API + worker + cron) | **TBD — production sizing not yet decided.** Staging validated the pattern on the $4/mo (512MB/1vCPU) tier; production traffic likely needs more headroom. Placeholder estimate: $12–24/mo (2–4GB tier) pending an actual decision — see "Production status" in `docs/deployment.md` before this becomes final. |
| DigitalOcean Spaces (state storage) | ~$0 marginal (shared bucket, already funded by staging) |
| DigitalOcean Managed Postgres (Basic, 1 GiB RAM/1 vCPU — shared with comprobify-web) | $15.15 |
| Mailgun Foundation (50k) | $35 |
| Sentry (base plan) | $29 |
| DigitalOcean App Platform (comprobify-web, 1 shared vCPU/1 GiB) | $12 |
| Redis | $0 (self-hosted container on the droplet — no incremental cost, same reasoning as `cron.d`; see Stack table) |
| GitHub | $0 (free tier) |
| **Subtotal** | **~$103–115** (using the droplet placeholder range) |
| **+15% ISD** (Ecuador card payments sent abroad) | **~$119–132/month** |

## Monthly cost — ceiling (every variable-billed item hits its stated worst case)

| Item | Cost |
|---|---|
| DigitalOcean Droplet | Same TBD range as above — resizing up is cheap and fast if needed (see "Day-2 operations" in `docs/terraform-digitalocean-setup.md`), but a true high-load ceiling here needs revisiting once production traffic is observed, not assumed in advance |
| DigitalOcean Managed Postgres (upgraded to 8 GiB RAM/4 vCPU tier, still shared with comprobify-web) | $122.10 |
| Mailgun | $35 (no stated cap past 50k sends — watch volume) |
| Sentry (base + full pay-as-you-go) | $29 + $100 = $129 |
| DigitalOcean App Platform (comprobify-web, upgraded to 2 shared vCPU/4 GiB) | $50 (plus $0.02/GiB on outbound transfer past the plan's included allowance — bounded, not open-ended) |
| **Subtotal** | **~$348–360** (using the droplet placeholder range) |
| **+15% ISD** | **~$400–414/month** |

> The 15% ISD figure is as given by the business — worth confirming against the currently published rate before treating it as permanently fixed, since it has changed more than once historically.
>
> Both tables above carry more uncertainty than usual right now because of the droplet sizing placeholder — recompute with a firm number once production is actually provisioned, rather than treating these as final.
>
> The Postgres and App Platform ceiling figures are a specific next-size-up tier, not a formula — re-pick the actual tier once real production load is observed, the same way the droplet placeholder is flagged for revisit.

---

## Why the ceiling isn't as scary as it looks

Unlike Neon's CU-hour compute billing (which scaled cost automatically and continuously with load), DigitalOcean Managed Postgres and App Platform both bill a **fixed price per provisioned tier** — reaching the "ceiling" above means a deliberate decision to upgrade to a bigger tier under sustained high load, not an automatic bill spike overnight. That said, the underlying capacity question is the same one that used to drive Neon's cost up: `src/constants/subscription-tiers.js` defines an `overagePerDocumentUsd` rate per tier that's *intended* to let a tenant pay for usage past their quota rather than get hard-blocked, which would be the natural revenue source to offset a volume-driven need to upgrade the database tier — **but overage billing isn't built yet** (`NEXT_STEPS.md` #7). Today, exceeding quota just hard-blocks document creation (`QuotaExceededError`, 402) — it caps the tenant's usage, and by extension caps how much any single tenant can drive load (and eventually tier-upgrade pressure) up, but there's no mechanism yet to actually collect the overage rate that would otherwise help fund an upgrade. Reaching the ceiling in practice would mean many tenants each using their full tier allotment, not a few tenants generating unlimited overage — a real but different scenario than "usage spike pays for itself."

---

## Breakeven: how many paying clients cover the monthly floor/ceiling

Using each paid tier's **net-of-IVA base** (what the business actually keeps — the IVA portion is collected on behalf of the tax authority and remitted, not usable revenue), assuming a single-tier client mix for simplicity. Using the low end of the floor/ceiling ranges above (droplet sizing TBD, so treat this table as similarly provisional):

| Tier | Gross price/mo | Net base/mo (at 15% IVA) | Clients to cover floor (~$119) | Clients to cover ceiling (~$400) |
|---|---|---|---|---|
| STARTER | $20 | $17.39 | 7 | 23 |
| GROWTH | $90 | $78.26 | 2 | 6 |
| BUSINESS | $230 | $200.00 | 1 | 2 |

Caveats:
- Real client mix will blend tiers — these are single-tier scenarios to bound the range, not a prediction.
- Excludes payment-processing fees (none currently — no gateway exists yet, `NEXT_STEPS.md` #6) and income tax on profit (a matter for the accountant, out of scope here).
- The floor/ceiling figures already include the 15% ISD add-on from the tables above — re-verify that rate periodically, per the note under the ceiling table.
- **Recompute this whole table once the droplet sizing decision is made** — right now it's built on the low end of a placeholder range, not a firm number.
- Recompute this table whenever `IVA_RATE` (now in `src/config/index.js`, see the "Config validation" section of `CLAUDE.md`) or the tier prices in `subscription-tiers.js` change.
- DigitalOcean Managed Postgres/App Platform pricing sourced from DigitalOcean's published pricing pages ([Managed Databases](https://www.digitalocean.com/pricing/managed-databases), [App Platform](https://docs.digitalocean.com/products/app-platform/details/pricing/)) as of this writing — re-verify before treating as final, same as the ISD rate.
