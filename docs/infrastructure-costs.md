# Infrastructure Costs — Production

Production platform decisions and the real cost baseline behind the subscription tier pricing in `src/constants/subscription-tiers.js`. Staging's stack is documented separately in `architecture-staging.drawio`; this file is production-only.

---

## Stack

| Layer | Platform | Role |
|---|---|---|
| API | Render (web service, Docker, Pro plan) | Express app — always-on, no scale-to-zero |
| API database | Neon (own project, `public` + `sandbox` schemas) | Production Postgres |
| Frontend | Vercel (Pro) | comprobify-web (Next.js) |
| Frontend database | Neon (separate project, same paid Neon account) | comprobify-web's own data — kept on a direct Neon project rather than Vercel's Postgres marketplace integration |
| Scheduled jobs | Render Cron Job | Used by both staging and production — see below |
| Email | Mailgun (Foundation, 50k sends) | Transactional email + delivery webhooks |
| Error monitoring | Sentry | 5xx tracking |
| Rate-limit store | Redis (Essentials) | Required once the API runs more than one instance — see `NEXT_STEPS.md` #8 |
| DNS | Cloudflare (free) | `api.comprobify.com` |
| CI/CD | GitHub + GitHub Actions (free tier) | |

---

## Why Render Cron Job instead of cron-job.org

cron-job.org is free but is a third-party dependency with no SLA, calling a Bearer-protected admin endpoint that drives tenant-facing notification and certificate-alert state. A Render Cron Job runs in the same account as the API, is billed per actual execution-second (not a flat monthly reservation), and is auditable in Render's own logs alongside the web service.

Render Cron Jobs scale by simply creating more Cron Job services — there's no fixed per-job fee, only the compute-seconds each run consumes. A job that runs for a few seconds every few minutes costs close to nothing, so adding a second or third scheduled job later is cheap.

**Staging now uses Render Cron Jobs too**, for the same reasons — it previously ran the notifications job through cron-job.org, but both environments follow the same pattern today (see `docs/deployment.md`'s "Scheduled jobs" section). The incremental cost is negligible either way, so this line item is effectively the same regardless of which environment.

---

## Neon: one paid account, multiple databases

Neon bills usage (CU-hours + storage) at the account level, not a flat fee per database. Running the frontend's database as its own Neon project under the same paid plan adds only the compute it actually consumes — no separate base subscription fee, unlike routing it through Vercel's Postgres marketplace integration, which adds Vercel's own markup on top of the underlying Neon usage.

---

## Monthly cost — floor (current low-load reality)

| Item | Cost |
|---|---|
| Render (API, Pro) | $25 |
| Neon — backend DB (Launch, low load) | $15 |
| Mailgun Foundation (50k) | $35 |
| Sentry (base plan) | $29 |
| Vercel Pro | $20 |
| Redis Essentials | $5 |
| Render Cron Job | ~$0 (fractions of a cent per run) |
| Neon — frontend DB (same account, incremental usage) | ~$0–10 — watch actual usage in the Neon dashboard |
| GitHub | $0 (free tier) |
| **Subtotal** | **~$129–139** |
| **+15% ISD** (Ecuador card payments sent abroad) | **~$148–160/month** |

## Monthly cost — ceiling (every variable-billed item hits its stated worst case)

| Item | Cost |
|---|---|
| Render | $25 (per instance — roughly doubles per added instance, see `NEXT_STEPS.md` #8) |
| Neon — backend DB (high load) | $353 |
| Mailgun | $35 (no stated cap past 50k sends — watch volume) |
| Sentry (base + full pay-as-you-go) | $29 + $100 = $129 |
| Vercel | $20 + **uncapped overage** (no published ceiling — set a budget alert) |
| Redis | $5 |
| **Subtotal** | **~$567 + uncapped Vercel overage** |
| **+15% ISD** | **~$652/month + uncapped Vercel overage** |

> The 15% ISD figure is as given by the business — worth confirming against the currently published rate before treating it as permanently fixed, since it has changed more than once historically.

---

## Why the ceiling isn't as scary as it looks

The dominant driver of the ceiling is Neon's backend compute scaling under heavy document volume — and heavy document volume is exactly what the per-invoice `overagePerDocumentUsd` rate in `src/constants/subscription-tiers.js` charges for. The same usage spike that pushes Neon's cost up also generates the overage revenue that funds it.
