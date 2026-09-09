# Bundling Comprobify into another product ("App B")

Planning notes for embedding Comprobify's invoicing into a separate product — working name "App B" throughout, a stock-control system for hair salons offered with an optional invoicing add-on ($15/mo without, $20/mo with). Nothing in this file describes anything built yet — it's the reasoning and the plan for when App B actually gets built, so the decisions already made don't have to be re-derived from scratch.

**You are a natural person (persona natural) operating both Comprobify and App B as the same legal entity/RUC.** Every recommendation below assumes that. If that ever changes (App B or Comprobify gets incorporated separately, or a real third party licenses either product), re-read the "If the entities are ever split" section before touching any of this.

---

## The two invoicing relationships — keep them separate

There are two completely independent buyer/seller relationships here, each needing its own Comprobify tenant. Don't conflate them.

### Flow 1 — you invoicing App B's customers

App B is your business, selling a real $15–20/mo service. Ecuadorian tax law requires *you* to issue an SRI factura for that revenue, same as any other business. Mechanically this is just normal Comprobify usage:

- Register **your own company** as a Comprobify tenant (an "operator tenant") — a normal customer account, on a normal plan (sized to your real App B subscriber count — GROWTH/BUSINESS, not FREE/SOLO/LITE, once volume justifies it).
- Bill each salon with `POST /v1/documents`, itemized however you want. A factura supports multiple `items[]` entries in one document, so "Suscripción App B — $15" + "Facturación electrónica — $5" as two lines on one $20 invoice is fine — SRI doesn't mandate a specific breakdown, that's presentation, not a legal requirement. (Still worth a quick sanity check with an accountant on wording/tax treatment before this is real revenue — this file is architecture reasoning, not tax advice.)

Nothing new needs to be built for this. It's the same `POST /v1/documents` flow every other Comprobify tenant already uses.

### Flow 2 — the salon invoicing its own customers

Each salon is its own legal business (own RUC), so each one needs its **own, separate Comprobify tenant** — there's no way to pool multiple businesses under one tenant via multi-branch, since every issuer under a tenant shares that tenant's RUC and certificate. This is an SRI/legal constraint, not a Comprobify design choice.

**Registration stays exactly as it is today (ADR-035): the salon registers at comprobify-web itself**, not through App B's API. No provisioning trust boundary needed on the Comprobify side — this was the first thing settled in this planning conversation, and it's the reason the harder "who's allowed to call `POST /v1/register`" question doesn't need revisiting for this integration.

Once the salon has registered and has an API key, it hands that key to App B (however App B's own UI collects it — a settings field, same shape as any "connect your account" integration). From then on, App B uses that key to call `POST /v1/documents` etc. on the salon's behalf whenever the salon needs to invoice *its* customers. This part also needs no new Comprobify code — it's the existing tenant-scoped API key model working exactly as designed.

---

## Funding the salon's Comprobify subscription

The salon's $5 (of the $20 App B charges) needs to turn into an active Comprobify subscription with real document quota — that's the part that needed design.

**Because you're the same legal entity on both sides, this is internal bookkeeping, not a second sale.** You already collected the $20 from the salon and issued them one factura for it (Flow 1). Activating their Comprobify plan afterward isn't a transaction between two parties — there's no second SRI document to produce for it. It only needs to *look* right in Comprobify's own admin/reporting views, since real money isn't moving through Comprobify's payment rails for it (no real SPI transfer, no real Payphone charge).

### Mechanism (not yet built)

Two existing admin endpoints already do exactly what's needed, mechanically:

1. `POST /v1/admin/tenants/:id/subscriptions` — creates the subscription (e.g. `{ tier: 'LITE', billingInterval: 'MONTHLY' }`) for the salon's tenant.
2. `PATCH /v1/admin/payments/:id/review` with `{ decision: "VERIFIED" }` — `reviewPayment()` doesn't require the payment to have gone through proof upload first, so this activates the subscription immediately (`applyVerifiedPayment` sets the tier + quota cap right away).

**Decision made: don't hand App B the full `ADMIN_SECRET`.** That would let a compromised App B backend suspend any tenant, read any tenant's event log, change any tier — far more power than "activate a subscription for a tenant I'm responsible for." Build a narrower, dedicated credential instead:

- A new middleware (mirrors `authenticate-admin.js`'s shape: a Bearer secret, constant-time compare, its own env var — something like `PARTNER_BILLING_SECRET`) gating two new, deliberately small routes:
  - Create a subscription for a given tenant ID.
  - Verify a payment for a given payment ID (VERIFIED only — no rejection path; there's nothing to reject in this flow since there's no real proof being submitted).
- Whether this needs real tenant-level scoping (a `partners`/tenant-link table so the credential can only act on tenants App B is actually responsible for) versus a single shared secret that can act on any tenant ID it's given is still open — the value of scoping-by-tenant here is mainly blast-radius reduction if the secret ever leaks (an attacker could otherwise grant itself free paid-tier quota on arbitrary tenants), not a real multi-party trust boundary, since there's only one partner and you operate both ends. Decide this when actually building it — start with the simpler shared-secret version unless the extra scoping feels worth the schema/migration cost at that time.

### Reporting

Add a new `PARTNER_COVERED` value to `src/constants/payment-methods.js` (alongside `SPI_TRANSFER`/`PAYPHONE_CARD`) and use it when the partner-billing route creates these payments. Purely for clarity in `GET /v1/admin/payments` and any future reporting — without it, these rows would look like unreviewed SPI transfers that got rubber-stamped with no proof, which is confusing to read later even though nothing is actually wrong. Not required for the mechanism to work, just for your own sanity when looking at the data in six months.

### Renewals

Comprobify opens a **new** `payments` row every renewal cycle (`processDueRenewals`) — this isn't a "set once" activation. Whatever calls the two endpoints above needs to run on a schedule (a small cron/job in App B, or triggered by App B's own renewal of the salon's $20 charge) and repeat this for every due cycle, not just at first signup.

---

## Practical checklist for when you build this

1. Decide the salon-facing Comprobify plan (LITE, given the volume profile — revisit if it changes).
2. Register your own "operator tenant" for Flow 1 if you haven't already, on a plan sized to real App B volume.
3. Build the App B UI step where a salon connects its Comprobify API key (Flow 2's document-creation path — needs no Comprobify-side work).
4. Build the partner-billing middleware + two routes on the Comprobify side (`PARTNER_BILLING_SECRET`, create-subscription, verify-payment).
5. Add `PARTNER_COVERED` to `payment-methods.js` + its DB CHECK constraint.
6. Build App B's renewal job that re-runs the create/verify pair every billing cycle for every active bundled salon.
7. Confirm the $20 → itemized-factura wording with an accountant before it's real invoiced revenue.

## If the entities are ever split

If Comprobify or App B ever becomes its own separate legal entity (incorporated separately, sold, or licensed to a real third party), the "internal bookkeeping" reasoning above stops holding — activating a salon's subscription would become a real B2B transaction between two businesses, and Comprobify's own operator tenant would need to invoice the other company for the wholesale amount, on top of (not instead of) whatever that company charges its own end customers. Re-derive the billing model from scratch at that point rather than assuming this plan still applies — get real accounting/legal advice before relying on any assumption in this file once that's true.
