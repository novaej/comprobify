# Infrastructure Costs — Production

Production platform decisions and the real cost baseline behind the subscription tier pricing in `src/constants/subscription-tiers.js`. Staging's stack is documented separately in `architecture-staging.drawio` / `docs/terraform-digitalocean-setup.md`; this file is production-only.

**Platform note:** staging moved from Render to a DigitalOcean droplet (see `docs/terraform-digitalocean-setup.md`) and validated the pattern in production before this file assumed it. Production, still on standby, is planned to follow the same DigitalOcean/Terraform model rather than provisioning a new Render service — the numbers below reflect that plan, with the one line item (droplet size) still an open decision flagged explicitly, not silently guessed.

---

## Stack

| Layer | Platform | Role |
|---|---|---|
| API + worker + scheduled jobs | DigitalOcean Droplet (Terraform-managed) | One droplet running Caddy, `api`, and `worker` as separate containers, plus a `cron.d` schedule for the 4 admin jobs — see `docs/terraform-digitalocean-setup.md`. Consolidates what would have been 3 separate Render line items (web service, background worker, cron jobs) into one compute cost. |
| State storage | DigitalOcean Spaces | Terraform remote state only (staging and production share the same bucket, different key prefix) — effectively $0 marginal cost for production, since staging already funds the account-level minimum |
| API database | Neon (own project, `public` + `sandbox` schemas) | Production Postgres |
| Frontend | Vercel (Pro) | comprobify-web (Next.js) |
| Frontend database | Neon (separate project, same paid Neon account) | comprobify-web's own data — kept on a direct Neon project rather than Vercel's Postgres marketplace integration |
| Email | Mailgun (Foundation, 50k sends) | Transactional email + delivery webhooks |
| Error monitoring | Sentry | 5xx tracking |
| Rate-limit store | Redis, provider TBD | Required once the API runs more than one instance — see `NEXT_STEPS.md` #8. Not yet built, so not yet a real cost. Render's own Redis add-on no longer applies now that compute is on DigitalOcean — likely candidates are Upstash or a Redis container on the droplet, not yet decided. |
| DNS | Cloudflare (free) | `api.comprobify.com` |
| CI/CD | GitHub + GitHub Actions (free tier) | |

---

## Why cron.d on the droplet instead of a separate scheduler

Same reasoning that applied to Render Cron Job over cron-job.org still holds, just running somewhere different now: a third-party scheduler with no SLA calling a Bearer-protected admin endpoint is a worse dependency than triggering the jobs from infrastructure you already control. The meaningful change from the Render era is cost, not design — a `cron.d` entry on a droplet you're already paying for costs nothing extra at all, not even the fractions-of-a-cent-per-run Render Cron Job billed. See `docs/terraform-digitalocean-setup.md`'s "Scheduled jobs" section for the actual mechanics (`docker compose exec` into the `api` container, no separate service).

---

## Neon: one paid account, multiple databases

Neon bills usage (CU-hours + storage) at the account level, not a flat fee per database. Running the frontend's database as its own Neon project under the same paid plan adds only the compute it actually consumes — no separate base subscription fee, unlike routing it through Vercel's Postgres marketplace integration, which adds Vercel's own markup on top of the underlying Neon usage.

---

## Monthly cost — floor (current low-load reality)

| Item | Cost |
|---|---|
| DigitalOcean Droplet (API + worker + cron) | **TBD — production sizing not yet decided.** Staging validated the pattern on the $4/mo (512MB/1vCPU) tier; production traffic likely needs more headroom. Placeholder estimate: $12–24/mo (2–4GB tier) pending an actual decision — see "Production status" in `docs/deployment.md` before this becomes final. |
| DigitalOcean Spaces (state storage) | ~$0 marginal (shared bucket, already funded by staging) |
| Neon — backend DB (Launch, low load) | $15 |
| Mailgun Foundation (50k) | $35 |
| Sentry (base plan) | $29 |
| Vercel Pro | $20 |
| Redis | $0 (not yet built — see Stack table) |
| Neon — frontend DB (same account, incremental usage) | ~$0–10 — watch actual usage in the Neon dashboard |
| GitHub | $0 (free tier) |
| **Subtotal** | **~$111–133** (using the droplet placeholder range) |
| **+15% ISD** (Ecuador card payments sent abroad) | **~$128–153/month** |

## Monthly cost — ceiling (every variable-billed item hits its stated worst case)

| Item | Cost |
|---|---|
| DigitalOcean Droplet | Same TBD range as above — resizing up is cheap and fast if needed (see "Day-2 operations" in `docs/terraform-digitalocean-setup.md`), but a true high-load ceiling here needs revisiting once production traffic is observed, not assumed in advance |
| Neon — backend DB (high load) | $353 |
| Mailgun | $35 (no stated cap past 50k sends — watch volume) |
| Sentry (base + full pay-as-you-go) | $29 + $100 = $129 |
| Vercel | $20 + **uncapped overage** (no published ceiling — set a budget alert) |
| **Subtotal** | **~$549–561 + uncapped Vercel overage** (using the droplet placeholder range) |
| **+15% ISD** | **~$631–645/month + uncapped Vercel overage** |

> The 15% ISD figure is as given by the business — worth confirming against the currently published rate before treating it as permanently fixed, since it has changed more than once historically.
>
> Both tables above carry more uncertainty than usual right now because of the droplet sizing placeholder — recompute with a firm number once production is actually provisioned, rather than treating these as final.

---

## Why the ceiling isn't as scary as it looks

The dominant driver of the ceiling is Neon's backend compute scaling under heavy document volume. `src/constants/subscription-tiers.js` defines an `overagePerDocumentUsd` rate per tier that's *intended* to let a tenant pay for usage past their quota rather than get hard-blocked, which would be the natural revenue source to offset a volume-driven cost spike — **but overage billing isn't built yet** (`NEXT_STEPS.md` #10). Today, exceeding quota just hard-blocks document creation (`QuotaExceededError`, 402) — it caps the tenant's usage, and by extension caps how much any single tenant can drive Neon's cost up, but there's no mechanism yet to actually collect the overage rate this section used to imply funds the ceiling. Reaching the ceiling in practice would mean many tenants each using their full tier allotment, not a few tenants generating unlimited overage — a real but different scenario than "usage spike pays for itself."

---

## Breakeven: how many paying clients cover the monthly floor/ceiling

Using each paid tier's **net-of-IVA base** (what the business actually keeps — the IVA portion is collected on behalf of the tax authority and remitted, not usable revenue), assuming a single-tier client mix for simplicity. Using the low end of the floor/ceiling ranges above (droplet sizing TBD, so treat this table as similarly provisional):

| Tier | Gross price/mo | Net base/mo (at 15% IVA) | Clients to cover floor (~$128) | Clients to cover ceiling (~$631) |
|---|---|---|---|---|
| STARTER | $20 | $17.39 | 8 | 37 |
| GROWTH | $90 | $78.26 | 2 | 9 |
| BUSINESS | $230 | $200.00 | 1 | 4 |

Caveats:
- Real client mix will blend tiers — these are single-tier scenarios to bound the range, not a prediction.
- Excludes payment-processing fees (none currently — no gateway exists yet, `NEXT_STEPS.md` #9) and income tax on profit (a matter for the accountant, out of scope here).
- The floor/ceiling figures already include the 15% ISD add-on from the tables above — re-verify that rate periodically, per the note under the ceiling table.
- **Recompute this whole table once the droplet sizing decision is made** — right now it's built on the low end of a placeholder range, not a firm number.
- Recompute this table whenever `IVA_RATE` (now in `src/config/index.js`, see the "Config validation" section of `CLAUDE.md`) or the tier prices in `subscription-tiers.js` change.
