# Infrastructure Costs — Production

Production platform decisions and the real cost baseline behind the subscription tier pricing in `src/constants/subscription-tiers.js`. Staging's stack is documented separately in `architecture-staging.drawio` / `docs/terraform-digitalocean-setup.md`; this file is production-only.

**Platform note:** production is live (since 2026-09-15) and follows the same fully-DigitalOcean, two-droplet model staging validated — the API/worker on their own droplet (see `docs/terraform-digitalocean-setup.md`), comprobify-web on its own separate droplet, both sharing one Managed Postgres cluster. **Staging itself has since been decommissioned (as of 2026-09-16) — only production runs today.** Everywhere below that describes staging in the present tense is describing the pattern it validated before teardown, not a currently-running environment; treat any "staging and production share X" cost reasoning as no longer applicable now that production bears its own costs alone (see "Actual observed production costs" below, and the DigitalOcean Spaces note in the Stack table).

---

## Stack

| Layer | Platform | Role |
|---|---|---|
| API + worker + scheduled jobs | DigitalOcean Droplet (Terraform-managed) | One droplet running Caddy, `api`, and `worker` as separate containers, plus a `cron.d` schedule for the 4 admin jobs — see `docs/terraform-digitalocean-setup.md`. Keeps compute, background worker, and scheduled jobs on one line item. |
| Database | DigitalOcean Managed Postgres (single shared cluster) | The API's `public` + `sandbox` schemas and comprobify-web's own schema live on one cluster, mirroring staging's setup — grouped into the same DO Project as the droplet for dashboard purposes only, not provisioned by this repo's Terraform. See "One shared cluster" below for why there's no separate frontend-database line item. |
| State storage | DigitalOcean Spaces | Terraform remote state only. Previously effectively $0 marginal cost for production, since staging (same bucket, different key prefix) already funded the account-level minimum — now that staging is decommissioned (2026-09-16), production funds that minimum alone, folded into the observed DO total below rather than broken out separately |
| Frontend | DigitalOcean Droplet (Terraform-managed, own repo) | comprobify-web (Next.js), its own droplet behind its own Caddy — deployed by that repo's own `deploy-staging.yml` over SSH, mirroring the API's own deploy shape (see comprobify-web's `docs/deployment.md`) |
| Email | Mailgun (Foundation, 50k sends) | Transactional email + delivery webhooks |
| Error monitoring | Sentry | 5xx tracking |
| Rate-limit store | Redis, self-hosted container on the droplet (`deploy/docker-compose.yml`'s `redis` service) | Backs `src/middleware/rate-limit.js`'s shared store (`src/services/redis.service.js`) so every `api` instance enforces one counter per key instead of counting independently — load-bearing once the API runs more than one instance (still just one today). Chosen over a managed provider (Upstash) since it only needs to be reachable by `api` replicas on the *same* droplet — the near-term scaling plan is Compose replicas on one droplet before ever provisioning a second one. See [ADR-026](adr/026-redis-shared-counter-store.md) for the full reasoning, including what changes if that scaling plan ever moves to multiple droplets. |
| DNS | Cloudflare (free) | `api.comprobify.com` |
| CI/CD | GitHub + GitHub Actions | ~$4/mo observed in production as of 2026-09-15 — past the free tier (private repo seats and/or Actions minutes), not $0 as originally assumed below |
| Payment processing | Payphone (card) + manual SPI bank transfer | Two payment methods, two cost profiles — see "Payment processing fees" below. Previously excluded from every cost/breakeven figure in this doc ("no gateway exists yet"); Payphone (ADR-028) has been live since, and the first real production transaction confirmed the actual commission rate. |

---

## Why cron.d on the droplet instead of a separate scheduler

A third-party scheduler with no SLA calling a Bearer-protected admin endpoint is a worse dependency than triggering the jobs from infrastructure you already control. A `cron.d` entry on a droplet you're already paying for costs nothing extra at all. See `docs/terraform-digitalocean-setup.md`'s "Scheduled jobs" section for the actual mechanics (`docker compose exec` into the `api` container, no separate service).

---

## DigitalOcean Managed Postgres: one shared cluster, not per-service databases

DigitalOcean Managed Postgres bills a **fixed price per cluster tier**, independent of how many logical databases or schemas run on it. There's therefore no cost reason to split the API and comprobify-web onto separate clusters — production uses its own dedicated cluster: the API's `public`/`sandbox` schemas and comprobify-web's own schema all live on one cluster, with each app capping its own client-side connection pool (`DB_POOL_MAX` for the API/worker, `connection_limit` on comprobify-web's `DATABASE_URL`) since the cluster has no PgBouncer or other pooler in front of it — see comprobify-web's `docs/deployment.md` ("DATABASE_URL connection budget on a shared cluster") for the connection-budget mechanics. This is also why the cost table below has one database line item instead of two.

---

## Monthly cost — floor (current low-load reality)

Both droplets' production sizing is now decided — `terraform/environments/production/terraform.tfvars` (API+worker) and comprobify-web's own `terraform/environments/production/terraform.tfvars` (frontend) both pin `droplet_size = "s-1vcpu-1gb"`, DigitalOcean's $6/mo Basic tier (confirmed against DigitalOcean's published [Droplets pricing](https://www.digitalocean.com/pricing/droplets)) — no longer a placeholder range:

| Item | Cost |
|---|---|
| DigitalOcean Droplet — API + worker + cron (`s-1vcpu-1gb`) | $6 |
| DigitalOcean Droplet — comprobify-web frontend (`s-1vcpu-1gb`) | $6 |
| DigitalOcean Spaces (state storage) | ~$5 (account-level minimum — no longer shared with a staging bucket now that staging is decommissioned, see "Actual observed production costs" below) |
| DigitalOcean Managed Postgres (Basic, 1 GiB RAM/1 vCPU — shared with comprobify-web) | $15.15 |
| Mailgun Foundation (50k) | $35 (modeled here at the standard published rate even though production hasn't actually needed the paid plan yet — see "Actual observed production costs" below for what's really being billed) |
| Sentry (base plan) | $29 (same "modeled at published rate, not yet actually billed" caveat as Mailgun above) |
| Redis | $0 (self-hosted container on the droplet — no incremental cost, same reasoning as `cron.d`; see Stack table) |
| GitHub | $4 (past the free tier — see updated Stack table above) |
| **Subtotal** | **$100.15** |
| **+15% ISD** (Ecuador card payments sent abroad) | **~$115.17/month** |

## Monthly cost — ceiling (every variable-billed item hits its stated worst case)

| Item | Cost |
|---|---|
| DigitalOcean Droplet — API + worker + cron | $6/mo today (same `s-1vcpu-1gb` as the floor) — resizing up is cheap and fast if sustained high load ever requires it (see "Day-2 operations" in `docs/terraform-digitalocean-setup.md`), but no specific higher tier is assumed here; revisit once real production load is actually observed, not guessed in advance |
| DigitalOcean Droplet — comprobify-web frontend | Same reasoning and same $6/mo starting point as the API droplet above |
| DigitalOcean Spaces | ~$5 (no stated higher tier assumed — see floor table) |
| DigitalOcean Managed Postgres (upgraded to 8 GiB RAM/4 vCPU tier, still shared with comprobify-web) | $122.10 |
| Mailgun | $35 (no stated cap past 50k sends — watch volume) |
| Sentry (base + full pay-as-you-go) | $29 + $100 = $129 |
| GitHub | $4 (same as floor — no stated higher-usage ceiling modeled) |
| **Subtotal** | **$307.10** |
| **+15% ISD** | **~$353.17/month** |

> The 15% ISD figure is as given by the business — worth confirming against the currently published rate before treating it as permanently fixed, since it has changed more than once historically.
>
> The Postgres ceiling figure is a specific next-size-up tier, not a formula — re-pick the actual tier once real production load is observed. The droplet rows are deliberately left at their current firm size rather than guessing a higher tier, for the same reason.

---

## Why the ceiling isn't as scary as it looks

DigitalOcean Managed Postgres and DigitalOcean Droplets both bill a **fixed price per provisioned tier/size** — reaching the "ceiling" above means a deliberate decision to upgrade to a bigger tier under sustained high load, not an automatic bill spike overnight. The underlying capacity question is still real, though: `src/constants/subscription-tiers.js` defines an `overagePerDocumentUsd` rate per tier that's *intended* to let a tenant pay for usage past their quota rather than get hard-blocked, which would be the natural revenue source to offset a volume-driven need to upgrade the database tier — **but overage billing isn't built yet** (`NEXT_STEPS.md` #4). Today, exceeding quota just hard-blocks document creation (`QuotaExceededError`, 402) — it caps the tenant's usage, and by extension caps how much any single tenant can drive load (and eventually tier-upgrade pressure) up, but there's no mechanism yet to actually collect the overage rate that would otherwise help fund an upgrade. Reaching the ceiling in practice would mean many tenants each using their full tier allotment, not a few tenants generating unlimited overage — a real but different scenario than "usage spike pays for itself."

---

## Payment processing fees

Tenants can pay via two methods (see CLAUDE.md's "Card payments (ADR-028)" and "Subscription + payment pipeline"), and only one of them carries a processing fee:

- **SPI bank transfer** — $0 fee. The tenant transfers `payments.total_amount` (base + IVA) directly into the business's own bank account; the operator manually verifies the uploaded proof (`PATCH /v1/payments/:id/proof` → `PATCH /v1/admin/payments/:id/review`). No gateway sits in this path at all.
- **Payphone card** — **5.75% commission, flat, confirmed both empirically and by Payphone's own published rate.** Payphone's pricing page (help.payphone.app, "Cuánto cuesta Payphone") states the fee as a 5% service commission plus 15% Ecuadorian IVA charged *on that commission* (not on the transaction total): `5% × 1.15 = 5.75%` of whatever amount is charged — their own worked example (charge $100 → $5.00 commission + $0.75 IVA-on-commission = $5.75 total, $94.25 received) is scale-illustrative, not a tier boundary; the ratio is identical at any amount. This matches the first live production transaction on this account exactly: a LITE `MONTHLY` subscription, $8.00 base × 1.15 (Comprobify's own IVA) = $9.20 charged, $0.53 commission shown on Payphone's own transaction detail as `Comisión (5.75%)` (0.53 / 9.20 = 5.76%, consistent within rounding). Two independent confirmations of the same flat rate, at two very different ticket sizes ($9.20 vs. Payphone's own $100 example) — safe to treat 5.75% as fixed rather than tiered/minimum-fee-adjusted.

**The commission is levied on the tax-inclusive total, not the base** — Payphone's own explanation makes this explicit (their fee's IVA is charged only on their commission, never a second time on the full transaction amount) — so its effective cost against the number that actually matters here (the ex-IVA base price, i.e. what `tier_prices.price_usd` publishes and what the business would otherwise keep in full) is higher than 5.75%:

```
net_per_card_payment = base − (0.0575 × base × 1.15) = base × (1 − 0.066125) ≈ base × 0.9339
```

i.e. **a card payment costs the business ~6.6% of the base price**, not 5.75% — worth remembering anywhere this rate gets quoted from memory instead of recomputed. Bank transfer has no such haircut: `net_per_bank_payment = base`, full stop.

**Payphone card, installments ("cuotas sin intereses") — not yet enabled, evaluated here for when it is.** Payphone offers the tenant interest-free installment plans, at a higher merchant commission and gated by a transaction minimum:

| Plan | Stated rate | Effective flat commission (same `%+IVA` structure as the base rate) | Minimum transaction (total charged) |
|---|---|---|---|
| Standard (no installments) | 5% + IVA | 5.75% | — |
| 3 months, no interest | 6% + IVA | 6.9% | $200 |
| 6 months, no interest | 8% + IVA | 9.2% | $450 |

Confirmed with the operator: Comprobify is paid the full net amount **upfront**, regardless of plan — Payphone/the card issuer carries the installment financing and collection risk, not the business. So enabling this is a pure margin trade-off with **no cash-flow downside**: nothing lost by having it available, since it only costs anything on transactions where a tenant actively opts in.

Using `net = base × (1 − 1.15 × commission)` (same derivation as the standard-card formula above, generalized to any commission rate):

| Tier/interval | Base | Total charged (base × 1.15) | Qualifies for 3-mo ($200+)? | Qualifies for 6-mo ($450+)? | Net — standard card | Net — 3-mo | Net — 6-mo |
|---|---|---|---|---|---|---|---|
| SOLO / LITE (either interval), STARTER monthly, GROWTH monthly | $12–$90 | $13.80–$103.50 | No | No | — | n/a | n/a |
| STARTER yearly | $200 | $230 | Yes | No | $186.78 | $184.13 (−$2.65) | n/a |
| BUSINESS monthly | $230 | $264.50 | Yes | No | $214.79 | $211.75 (−$3.05) | n/a |
| GROWTH yearly | $900 | $1,035 | Yes | Yes | $840.49 | $828.59 (−$11.91) | $804.78 (−$35.71) |
| BUSINESS yearly | $2,300 | $2,645 | Yes | Yes | $2,147.91 | $2,117.50 (−$30.41) | $2,056.66 (−$91.24) |
| ENTERPRISE monthly | $450 | $517.50 | Yes | Yes | $420.24 | $414.29 (−$5.94) | $402.39 (−$17.84) |
| ENTERPRISE yearly | $4,500 | $5,175 | Yes | Yes | $4,202.44 | $4,142.93 (−$59.51) | $4,023.90 (−$178.54) |

So this only ever applies to the larger/annual commitments (STARTER-yearly and up) — nothing at SOLO/LITE/STARTER-monthly/GROWTH-monthly scale meets even the $200 minimum. The likely case *for* enabling it isn't the extra margin given up on transactions where it's used — it's the conversion/retention effect: a tenant facing a $2,645 BUSINESS-yearly card charge may not commit to that in one shot but would say yes to 6 painless installments, and a tenant who converts to yearly this way pays the card commission once instead of up to 12 times and is meaningfully stickier than a month-to-month subscriber. Note yearly pricing already bakes in its own "2 months free" discount over monthly billing (a separate, deliberate pricing decision) — so "yearly with installments" nets less per dollar than 12 separate monthly card charges would; the right comparison is "yearly-with-installments vs. tenant doesn't commit to yearly at all," not against monthly billing.

---

## Actual observed production costs (as of 2026-09-16, prod-only)

The floor/ceiling tables above were built entirely on placeholders before production was ever provisioned. Now that it is — and now that staging has been decommissioned, so every figure below is production's own cost with nothing shared — here's what's actually being paid, month to month:

| Item | Cost | Notes |
|---|---|---|
| DigitalOcean (both droplets + Managed Postgres + Spaces, one invoice, prod-only) | **~$40/mo** | Originally observed at $35/mo while staging still existed; bumped to $40 as a deliberate buffer to absorb Spaces' account-level minimum no longer being shared with a staging bucket, and any other small shift from the teardown — treat as provisional until a clean post-teardown invoice confirms the real number. Still below the old floor table's low end for these three line items combined (~$39: $12 + $12 + $15.15). No per-item breakdown captured here; pull it from the DO billing dashboard once one full post-teardown billing cycle has passed. |
| GitHub | **$4/mo** | Was assumed $0 (free tier) — see updated Stack table above |
| Claude (AI development tooling) | **$20/mo** | Not in the original Stack/cost tables at all — an engineering-tooling cost, not request-serving infrastructure, so it doesn't scale with tenant/document volume the way DO/Mailgun/Sentry do. Included here because it's real recurring spend relevant to breakeven, but keep it mentally separate from the "infra that serves traffic" costs above it. |
| Mailgun | **$0** | Still within a free/trial tier — production volume hasn't required the paid Foundation plan (~$35/mo) yet |
| Sentry | **$0** | Still within the free Developer tier — production error volume hasn't required the paid base plan (~$29/mo) yet |
| **Real total, today** | **~$64/mo** | $40 + $4 + $20; Mailgun/Sentry currently contribute $0 |
| **Near-future total** (once Mailgun/Sentry volume forces their paid tiers) | **~$128/mo** | $64 + $35 (Mailgun Foundation) + $29 (Sentry base) — still lands close to the old floor table's ~$119 estimate, a reassuring consistency check on the rest of that table even though its droplet/DB/staging-sharing assumptions have now been superseded |

This section is informational only — tracking real current cash outflow, not what pricing feasibility should be judged against. The breakeven table below deliberately does **not** use these numbers: it prices against the floor/ceiling tables above, which already assume every provider (Mailgun, Sentry included) is paid at standard published rates, not whatever happens to still be free today. Pricing decisions built on a temporary free tier would need re-deriving the moment that tier runs out — the floor/ceiling baseline doesn't have that problem. Recompute the figures in this section once Mailgun/Sentry actually start billing, once a full post-teardown DO invoice confirms the real prod-only number (replacing the $40 buffer), and once the DO droplets are resized for real traffic rather than today's near-zero load.

---

## Breakeven: how many paying clients cover the monthly floor/ceiling

Using each paid tier's **ex-IVA base price** — `tier_prices.price_usd`, confirmed by `subscription.service.js`'s `breakdownAmount()` to already be "the advertised, ex-IVA sticker price" — as the business's net-of-IVA revenue per payment, before any card commission. (An earlier version of this table divided the sticker price by 1.15, treating it as tax-*inclusive* and computing IVA the wrong direction; that was wrong — the code confirms the sticker price is already the pre-tax base the business keeps, and IVA is added *on top* to produce what the tenant is actually charged. Fixed here.)

Assuming a single-tier, single-payment-method client mix for simplicity. Priced against **floor** (~$115/mo) and **ceiling** (~$353/mo) from the cost tables above — both already assume every provider (Mailgun, Sentry included) is paid at standard published rates, not today's temporarily-free reality, since pricing feasibility should hold even after the free tiers run out. (See "Actual observed production costs" above for what's *actually* being billed today, kept separate and not used here for exactly that reason.)

| Tier | Base price | Net/payment — bank | Net/payment — card | Clients — floor (~$115) bank/card | Clients — ceiling (~$353) bank/card |
|---|---|---|---|---|---|
| SOLO (yearly only, ÷12) | $45/yr | $3.75/mo | $3.50/mo | 31 / 33 | 95 / 101 |
| LITE (monthly) | $12/mo | $12.00 | $11.21 | 10 / 11 | 30 / 32 |
| STARTER (monthly) | $20/mo | $20.00 | $18.68 | 6 / 7 | 18 / 19 |
| GROWTH (monthly) | $90/mo | $90.00 | $84.05 | 2 / 2 | 4 / 5 |
| BUSINESS (monthly) | $230/mo | $230.00 | $214.79 | 1 / 1 | 2 / 2 |

ENTERPRISE ($450/mo base) isn't tabled — at $420–450 net per client either payment method, one client already covers both the floor and the ceiling.

**Read:** even against the fully-paid-providers ceiling (~$353/mo, the conservative end), the platform breaks even on a modest client count — 30–32 LITE clients (the cheapest, most price-sensitive tier), 18–19 STARTER, or as few as 4–5 GROWTH clients. At the floor, it's a small handful either way. That's the number to actually judge pricing against, since it doesn't rely on Mailgun/Sentry staying free.

Caveats:
- Real client mix will blend tiers *and* payment methods — these are single-tier, single-method scenarios to bound the range, not a prediction. A tenant can also switch payment method per payment (there's no account-level lock), so even a single tenant's own contribution varies month to month.
- SOLO is yearly-only by design (`subscription-tiers.js`'s own comment: a small monthly charge carries processing/support overhead disproportionate to its size) — LITE was not given the same protection despite being priced similarly low per month, and now has a confirmed recurring ~6.6% haircut on every card-paid `MONTHLY` cycle if a LITE tenant pays by card. Worth revisiting whether LITE should nudge tenants toward yearly billing or bank transfer the same way SOLO does, once card-vs-transfer mix is observed at scale.
- Still excludes income tax on profit (a matter for the accountant, out of scope here).
- The floor/ceiling figures already include the 15% ISD add-on from the tables above — re-verify that rate periodically, per the note under the ceiling table. ISD is a separate cost from the Payphone commission (ISD applies to *this business's own* outbound card spend on foreign services; the Payphone commission applies to *tenants'* inbound card payments) — do not conflate the two 15%-ish-adjacent figures.
- The floor/ceiling figures are firm on droplet sizing (both are decided) but still model Mailgun/Sentry as paid even though they're currently free, and DO Spaces/GitHub at their current observed cost — recompute if any provider's actual rate changes.
- Recompute this table whenever `IVA_RATE`, the Payphone commission rate, the tier prices in `tier_prices`, or any provider's published rate changes.
- DigitalOcean Managed Postgres/Droplet pricing sourced from DigitalOcean's published pricing pages ([Managed Databases](https://www.digitalocean.com/pricing/managed-databases), [Droplets](https://www.digitalocean.com/pricing/droplets)) as of this writing — re-verify before treating as final, same as the ISD rate.
