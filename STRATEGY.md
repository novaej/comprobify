# Product Strategy

Strategic analysis for Comprobify — living document, update as the market and product evolve.

See [NEXT_STEPS.md](NEXT_STEPS.md) for the technical implementation backlog.

---

## What this is

A B2B API product for Ecuadorian electronic invoicing (comprobantes electrónicos SRI).
Target customers: developers and companies with existing systems (POS, ERP, e-commerce, accounting SaaS)
that need to emit legal electronic invoices programmatically — not through a UI.

**Current reality:** one developer, no clients yet, no company. The goal is to use it for your
own invoices first, get 5-10 developer friends using it free, then charge the next batch.
Everything in this document is oriented toward that path — not a Series A.

---

## Core principle: Comprobify is an invoicing engine, not a platform

Comprobify's responsibility begins and ends with the SRI document lifecycle:

```
Issuer + Payload → Sign → Send → Authorize → Return XML + RIDE PDF
```

**Comprobify owns:**
- Issuers (RUC, certificate, branch configuration)
- API keys (authentication)
- Documents (XML, access key, status, audit trail)
- Sequential numbers

**Comprobify does NOT own:**
- User accounts and login sessions
- Buyer / client address books
- Product and service catalogs
- Invoice templates or drafts
- Pricing tiers, subscriptions, billing

Those belong to the application built on top of Comprobify — whether that is the
Comprobify Web frontend or a client's own system.

Think of Stripe: Stripe does not manage your users or your products. You call Stripe to
process payments. Your application manages everything else. Comprobify works the same way.

**Why this matters for the API product:**
A developer buying Comprobify access already has users, products, and clients in their
own system. They do not want an invoicing API dictating how those are managed. Keeping
the boundary clean makes Comprobify more composable and more valuable as a focused tool.

**Why this matters for the web frontend:**
The frontend is an application built on top of Comprobify, not an extension of it.
It manages its own users, buyers, and products in its own database. The only data that
crosses the boundary is the invoice payload (sent to Comprobify) and the access key +
status (returned by Comprobify).

---

## Phased roadmap

### Phase 1 — Use it yourself (now)

**Goal:** run your own invoices through it in production. Find the bugs that only appear
with real SRI interactions and real data.

**What you need:** a deployed instance + your own P12 and RUC loaded via the admin API. Nothing else.

**Lawyer:** no. You are processing your own data.

**Infrastructure:** Azure's free F1 tier is too limited (60 CPU minutes/day, apps sleep).
Better cheap options for a solo developer:

| Platform | App/month | DB/month | Total | Notes |
|---|---|---|---|---|
| Railway | ~$5 | ~$5 | ~$10 | Simplest, doesn't sleep, pay as you go |
| Render | $7 | $7 | ~$14 | Good DX; matches the `feat/render-deploy` branch |
| Azure B1 | ~$13 | ~$13 | ~$26 | More control; matches existing CI/CD |

Migrating between platforms later is easy (see "Platform portability" below). Pick the
cheapest one now and move when the time comes.

### Phase 2 — First 5-10 users like you (free)

**Goal:** prove someone besides you will use it. Get real feedback. Don't charge yet.

**Who to target:** developers in Ecuador — LinkedIn, Slack groups, Facebook groups for
freelance devs and accounting software communities. Pitch: "I built a REST API for SRI
electronic invoices, want to try it for free?"

**What you need:**
- A landing page (a single-page README-style site is enough)
- Manual onboarding: you create their issuer via the admin API yourself
- Terms of Service: use a free template generator (Termly, Iubenda, or similar)
- Your personal email for support

**Do you need a lawyer?** No. These are free users. No contracts, no payments.

**API or UI?** These users are developers — give them API keys. No frontend needed yet.
If a user turns out not to be a developer, onboard them manually (you fill in their invoices
via the API while they figure out their workflow). Don't build a UI to solve one person's problem.

### Phase 3 — First 10-30 paying clients

**Goal:** prove someone will pay. Even $29/month × 10 = $290/month covers infrastructure
and proves the model.

**What you now actually need:**
- **Payment processing** — see "Payments in Ecuador" section below. Start with manual
  bank transfer (SPI); add a payment gateway when volume justifies the integration work.
- **Terms of Service + Privacy Policy** — matters now because you are taking money and
  processing third-party data under LOPDP.
- **DPA template** — a 1-2 page document establishing you as data processor, client as
  data controller. Find an LOPDP-compliant template online or have a lawyer review one
  for $150-300 one time.
- **Rate limiting** — must be live before you have multiple tenants (NEXT_STEPS #1).
- **Health endpoint** — needed for uptime monitoring (NEXT_STEPS #3).

**Lawyer?** One consultation to review your T&S and DPA. Not a retainer. ~$150-300.

### Phase 4 — Company formation (when you have revenue)

Once you have consistent revenue (~$500-1,000 MRR), it makes sense to:
- Register a business entity in Ecuador (SAS or Sociedad Anónima)
- Open a business bank account
- Handle tax obligations properly (IVA, retenciones, impuesto a la renta)

Do not do this before you have paying clients. The overhead has no benefit at Phase 1-2.
Many successful products ran as sole proprietorships for the first year.

---

## Platform portability

Short answer: yes, very easy to move. The app is a stateless Node.js process and a
PostgreSQL database. Every PaaS and cloud provider speaks both.

Migration procedure:
1. `pg_dump` the old database
2. `pg_restore` into the new database
3. Copy environment variables to the new platform
4. Deploy the app
5. Update DNS to point to the new host
6. Decommission the old deployment

Total effort: 1-3 hours. There will be a few minutes of downtime during the DNS cut,
which matters more at 500 clients than at 5. Don't let this concern delay a deployment
decision now.

The only thing that creates lock-in is if you use a platform-specific feature (e.g.,
Azure Blob Storage, Railway's private networking). As long as the app only depends on
a PostgreSQL connection string and environment variables, it is fully portable.

---

## Payments in Ecuador

**Stripe is not available** for Ecuador-based merchant accounts. You cannot create a
Stripe account to receive payments if your business is registered in Ecuador.

### Option 1: Manual SPI bank transfer (recommended for Phase 1-3)

Ecuador's SPI (Sistema de Pagos Interbancarios) allows instant transfers between any
Ecuadorian banks. For B2B, manual invoicing + bank transfer is the most common payment
method — clients are already used to it.

Process: send them a monthly invoice → they transfer → you activate/renew their account.

**Pros:** zero setup, zero fees, clients expect it.
**Cons:** manual, doesn't scale past ~50 clients without becoming painful.

### Option 2: Local payment gateways (Phase 3-4)

| Gateway | Origin | Fit | Notes |
|---|---|---|---|
| Kushki | Ecuador | Best | Founded in Ecuador, supports cards + SPI, solid B2B API |
| PayPhone | Ecuador | Good | Widely adopted, simpler, more consumer-oriented |
| PlacetoPay | Colombia | Good | Used across Ecuador, solid B2B support |
| PayU | Global | OK | Available in Ecuador, higher fees |

Kushki is the strongest recommendation for a developer-founded SaaS in Ecuador.
They have an API-first integration model and understand the local market.

### Option 3: International entity (advanced)

If the product grows and you want to accept international clients or use Stripe,
you would need a legal entity in a Stripe-supported country (US, UK, EU). This is
a legitimate path but it is a Phase 4+ decision — don't plan for it now.

---

## Frontend

**Decision: build a web UI alongside the API.**

Model:
- **Web UI** — for general users (you, your clients, anyone who doesn't want to call an API)
- **REST API** — for developers and businesses integrating programmatically

The frontend is a UI layer on top of the existing API. No backend changes required for MVP.
See [FRONTEND_MVP.md](FRONTEND_MVP.md) for screens, tech stack, auth approach, and
deployment plan.

**One API gap to fill before the frontend can launch:** `GET /api/documents` (paginated list
filtered by authenticated issuer). Everything else already exists.

---

## Does a competitor already exist?

Yes. The most direct one is **Datil** (`datil.co`), an Ecuadorian company that has offered an
electronic invoicing API since roughly 2013. Their existence is the most important data point
in this analysis — it proves the market is real and has sustained demand for over a decade.

Other players worth tracking:

| Name | Origin | Notes |
|---|---|---|
| Datil | Ecuador | Direct API competitor; longest track record |
| Facturama | Mexico | Covers Ecuador among other LATAM countries |
| Siigo / Alegra | Colombia | Broader accounting SaaS; SRI support is secondary |
| Local Ecuadorian ERPs | Ecuador | Mostly UI-first; API is an afterthought |

**Why "they exist" is not a reason to stop:**

- Datil has operated for 10+ years, which means companies are actively paying for this.
- An older product accumulates technical debt. A fresh API built on modern patterns
  (idempotency, webhooks, RFC 7807 errors, REST instead of SOAP-shims) can out-execute on DX.
- Ecuador's mandatory electronic invoicing is expanding — new company categories are added
  regularly. The addressable market is growing, not shrinking.
- The right benchmark is not "does it exist" but "can we reach a sustainable number of
  paying customers before running out of motivation."

---

## Why don't more companies build their own?

Several companies do, particularly large ones. The reasons:

1. **Data sovereignty** — Invoice data reveals who you sell to, how much, and what.
2. **Compliance requirements** — Financial institutions and government contractors
   sometimes restrict third-party data processing.
3. **Perceived reliability** — "What if the SaaS goes down? We can't issue invoices."
4. **One-time cost preference** — Some prefer paying developers once over monthly fees.
5. **Customization** — SRI requirements evolve; they don't want to depend on a vendor.

**Who builds their own:** large enterprises with dedicated IT departments. Not our market.

**Who does not:** SMEs, startups, software companies building products for their own clients.
They can't justify the engineering cost. This is the target segment.

---

## The shared database concern

This is a legitimate objection and must be addressed both technically and contractually.

### What data is actually in the database

- Buyer RUC, name, and address
- Invoice amounts and line items
- Product/service descriptions
- The issuer's encrypted private key (AES-256-GCM)

### Technical isolation guarantees

Current architecture is **row-level multi-tenancy**: all clients share one database,
isolated by `issuer_id` enforced at the application layer via API key authentication.

**Risks:**
- An application bug (SQL without a tenant filter) could expose another tenant's data.
- A compromised admin account has access to all tenants.
- A breach or subpoena affects all tenants simultaneously.

**Mitigations:**

| Measure | Status |
|---|---|
| `issuer_id` filter on every query | Done — enforced via `req.issuer` |
| No SQL string interpolation | Done — project rule |
| PostgreSQL Row-Level Security (RLS) | Not yet — highest-leverage addition to make |
| Encryption at rest | Depends on hosting provider |
| Private key never logged or returned | Done |

**PostgreSQL RLS is the highest-leverage improvement.** With RLS enabled, even a bug
that forgets `WHERE issuer_id = $1` cannot return another tenant's rows — the database
enforces the policy independently of the application. This should be in NEXT_STEPS.

### Deployment tiers as a data isolation strategy

| Tier | Isolation model | Who it fits |
|---|---|---|
| Shared (default) | Row-level, application-enforced | SMEs, startups, SaaS builders |
| Dedicated instance | Separate app + DB, managed by us | Mid-market with compliance requirements |
| Self-hosted | Client runs their own deployment | Enterprises, financial institutions |

### Contractual protection

Before onboarding paying clients:
- **DPA** — required under Ecuador's LOPDP (2021). Establishes Comprobify as data processor,
  client as data controller. Limits what can be done with invoice data.
- **SLA** — defines uptime commitment and remedy.
- **Data deletion clause** — client data deleted within N days of contract termination.

A vendor that arrives with a ready DPA reduces procurement friction for clients with legal teams.

---

## Differentiators

### vs. accounting software (Monica, Fénix, Siigo)

Those are UIs for accountants. This is an API for developers. A company with a custom POS
cannot use accounting software — they need a POST endpoint.

### vs. DIY SOAP integration

SRI's SOAP interface requires: WSDL parsing, Module 11 check digit, XSD validation,
XAdES-BES digital signatures, P12 certificate management. A competent developer needs
4-8 weeks to build a reliable implementation. This collapses that to hours.

### vs. Datil and other API services

| Feature | Comprobify | Datil (estimated) |
|---|---|---|
| Idempotency keys | Yes | Unknown |
| Full audit trail | Yes | Unknown |
| RFC 7807 error responses | Yes | Unknown |
| Webhooks on status change | Planned | Unknown |
| Async SRI submission | Planned | Unknown |
| Multi-branch support | Yes | Unknown |
| Email with RIDE PDF on authorization | Yes — included | Unlikely |
| PostgreSQL RLS | Planned | Unknown |
| Self-hosted option | Possible | No |

### The reliability argument (strongest differentiator)

Idempotency is the feature most clients won't ask for but will be most grateful for.
A POS that retries a failed invoice request without idempotency creates a duplicate invoice —
a legal problem with SRI and an accounting problem with the buyer.

---

## Pricing model

**Recommendation: subscription with included quota + overage.**

| Tier | Price/month | Invoices included | Overage | Issuers | Write rate limit | Webhooks |
|---|---|---|---|---|---|---|
| Free | $0 | 100 | — | 1 | 10 req/min | No |
| Starter | $29 | 1,000 | $0.04/invoice | 2 | 60 req/min | No |
| Growth | $79 | 5,000 | $0.025/invoice | 5 | 120 req/min | Yes |
| Business | $199 | 20,000 | $0.015/invoice | unlimited | 300 req/min | Yes |
| Enterprise | custom | unlimited | negotiated | unlimited | custom | Yes + SLA |

**Features as tier gates:**
- Free / Starter: facturas (`01`) only
- Growth+: credit notes (`04`), retenciones (`07`), other document types
- Growth+: webhooks (polling is free; push is paid)
- Business+: reporting endpoints, CSV export
- Enterprise: dedicated instance option, DPA with SLA, custom rate limits

**Infrastructure cost sanity check:**
- Railway/Render: ~$14-30/month baseline
- At 10 Starter clients: $290/month → covers infrastructure
- At 100 clients at $60 average ARPU: $6,000 MRR → viable product
- At 500 clients at $70 average ARPU: $35,000 MRR → fundable or acquirable

---

## What to build next (product-priority order)

See [NEXT_STEPS.md](NEXT_STEPS.md) for implementation details on each item.

1. **Rate limiting** (NEXT_STEPS #1) — required before multi-tenant; design tier-aware
2. **Health endpoint** (NEXT_STEPS #3) — table stakes for production
3. **PostgreSQL RLS** — not in NEXT_STEPS yet; highest-leverage data isolation improvement
4. **Webhooks** (NEXT_STEPS #4) — clearest paid-tier differentiator
5. **Additional document types** (NEXT_STEPS #2) — gate behind Growth tier
6. **Async worker** (NEXT_STEPS #5) — pairs with webhooks; makes the async model usable
7. **DPA template** — required before Phase 3; legal, not code
8. **Kushki billing integration** — when manual SPI transfers become unmanageable
9. **Reporting** (NEXT_STEPS #8) — Business tier feature

The async worker + webhooks combination is the feature Datil almost certainly does not
offer cleanly. Fire-and-forget submission with push notification on authorization is a
meaningfully better developer experience than polling for 5-30 seconds.

---

## Open questions to revisit

- What does Datil actually charge? (pricing may be behind a sales call)
- Are there LOPDP-specific requirements for invoice data processors beyond a DPA?
- Is there a market for a self-hosted license? (talk to 2-3 potential enterprise clients
  before building anything for that segment)
- Should the free tier require a credit card? (reduces abuse, filters serious users)
- When do non-developer users appear, and is that the signal to start the frontend?
