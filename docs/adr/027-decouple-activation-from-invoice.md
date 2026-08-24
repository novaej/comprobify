# ADR-027: Subscription Activation Decoupled from the Operator's Invoice

## Status
Accepted — supersedes ADR-017's activation clause.

## Date
2026-08-23

## Context

ADR-017 established the manual subscription pipeline and made one rule central to it: **a subscription only becomes `ACTIVE` once its linked invoice document is SRI-`AUTHORIZED` — never merely on payment.** The stated reasoning was dogfooding: "granting paid access against an unauthorized invoice is exactly the kind of gap this product exists to close for everyone else."

That instinct is right about the *obligation* to issue the factura. It was implemented as a *gate on the customer*, and those are not the same thing.

The consequences in practice:

- **The customer absorbs an operator-side failure.** SRI outages are routine — this codebase has `RETURNED`/`NOT_AUTHORIZED` rebuild flows precisely because they happen. A tenant whose money was already captured sat locked out of a service they had paid for, for reasons entirely on the operator's side of the boundary.
- **Nothing in Ecuadorian law requires the factura to precede service delivery.** Issuing it is a real legal duty, on the operator's clock; the timing of service access is a separate, purely product decision that the gate silently welded to it.
- **The gate never detected anything.** It only added latency between payment and access. It offered no protection against a reversed charge or a chargeback — those surface days-to-weeks later, from a bank statement or a payment provider's dashboard, long past any gate.
- **Activation was operationally coupled to a human step.** The operator had to self-bill an invoice by hand and link it before the tenant's tier was granted. Nothing tracked that obligation except the tenant being locked out, which made "customer waiting" the only reminder mechanism.

The forcing-function argument for keeping it ("otherwise invoices might silently never get issued") was real when self-billing was a step someone had to remember with no other prompt. That is what this ADR replaces.

## Decision

**Payment verification alone grants access. The invoice obligation is tracked by an explicit operator work queue instead of by withholding service.**

### 1. One place where a verified payment becomes access

`subscriptionService.applyVerifiedPayment(payment, subscription)`, called from `reviewPayment()`'s `VERIFIED` branch. It dispatches on `payment.purpose` and absorbs, essentially verbatim, the bodies of the three functions that previously ran on invoice authorization:

| Purpose | Behaviour (unchanged logic, new trigger) |
|---|---|
| `INITIAL` | Subscription → `ACTIVE`, period opened anchored to "now" (correct here: first cycle), tier + quota cap granted, `SUBSCRIPTION_ACTIVATED` logged, `PAST_DUE` → `ACTIVE` recovery (ADR-025) |
| `TIER_CHANGE` | Immediate tier flip, or `scheduleDowngrade` when `target_billing_interval` is set (deferred interval change, unchanged) |
| `RENEWAL` | Period extended, anchored to the **old** `current_period_end`, never "now" |

Deleted, since all four existed solely to react to invoice authorization: `activateIfLinked`, `applyTierChangeIfLinked`, `applyRenewalIfLinked`, `applyPendingInvoiceLinks` (and its step in `POST /v1/admin/jobs/subscriptions`), plus `linkSandboxDocument` — the sandbox fork existed only because a sandbox document couldn't be stored as an FK yet still had to *trigger* activation; with nothing triggering off documents, it collapses.

`subscriptions.status` keeps `PAYMENT_RECEIVED` and `INVOICE_PROCESSING` in its CHECK constraint as **legacy values**: nothing writes them any more, but historical rows carry them and dropping the values would invalidate that history for no gain.

### 2. `linkInvoice` becomes pure bookkeeping

It records which document settles which payment and stamps `payments.invoiced_at`. No state transition of any kind. The two FK columns keep their distinct meanings (Common Mistake #37): `subscriptions.initial_invoice_document_id` is write-once and records what originally activated the subscription — now enforced structurally by a `WHERE initial_invoice_document_id IS NULL` guard in `subscriptionModel.setInitialInvoiceDocument` rather than by convention — while every later funding event writes its own `payments.invoice_document_id`.

### 3. `payments.invoiced_at` is the queue signal, not `invoice_document_id`

A sandbox-linked document sets neither FK (both reference `public.documents`; `sandbox.documents` is an independent id sequence that can collide with it), so `invoice_document_id IS NULL` would report an already-invoiced sandbox payment as pending forever — the same class of bug Common Mistake #35 documents. `invoiced_at` is stamped in both environments.

`GET /v1/admin/invoicing/pending` returns `{ count, items }` where each item carries the amounts, the period being billed, and the buyer's legal identity (`business_name`/`ruc`/`main_address`, resolved from the tenant's oldest active issuer — `tenants` itself carries only `email`), so the admin UI can prefill an invoice form rather than making the operator cross-reference tabs.

Deliberately **no operator notification email in this change**: the operator is the one calling `PATCH /v1/admin/payments/:id/review`, so they already know an invoice is owed the moment they verify. That changes when card payments land (nothing human verifies those), and the nudge email belongs in that change.

### 4. Refund rollback, because manual rollback is wrong

Removing the gate makes it necessary to answer "what happens when money comes back" properly. Detection stays manual and always will be — an SPI reversal appears only on a bank statement. But *responding* could not be left to the existing admin endpoints:

- `PATCH /v1/admin/tenants/:id/tier` writes only `tenants.subscription_tier` and the quota cap; it never touches `subscriptions.tier`. A hand-rolled downgrade left the subscription row still claiming the reversed tier, and `createRenewalReminder` prices the next renewal off `subscription.tier` — so the tenant would be billed for an upgrade they never actually paid for.
- **Rolling back is not "downgrade to FREE."** A reversed `TIER_CHANGE` must return to the *previous paid tier*; a reversed `RENEWAL` must roll the period back without touching tier at all; only a reversed `INITIAL` ends at FREE.
- Nothing had ever written the `REFUNDED` value present in `chk_payments_status` since migration 052.

`applyVerifiedPayment` therefore records `payments.applied_from` — a JSONB snapshot of `{ tier, billingInterval, periodStart, periodEnd, subscriptionStatus, tenantTier }` captured immediately *before* it changes anything. `tenantTier` is captured separately from the subscription's own tier because they legitimately differ: an `INITIAL` payment's subscription already reads `STARTER` at creation while the tenant is still `FREE`.

`PATCH /v1/admin/payments/:id/refund` restores that snapshot, marks the payment `REFUNDED`, and logs a new `PAYMENT_REFUNDED` tenant event. It refuses (`400 PAYMENT_NOT_REFUNDABLE`) when `applied_from` is absent — a payment applied before this migration cannot be rolled back automatically, and guessing would corrupt state. It deliberately does **not** suspend the tenant: whether a reversal warrants `SUSPENDED` (fraud) or nothing at all (an honest duplicate charge) is a separate operator judgement.

One exception to verbatim restoration: a reversed `INITIAL` sets the subscription to `CANCELLED` rather than restoring its `PENDING_PAYMENT` snapshot status, which would leave a subscription that looks payable but whose only payment is `REFUNDED` — and would block the tenant from starting a new one via `findActiveOrPendingByTenantId`.

### 5. Suspension reason becomes an enum

`PATCH /v1/admin/tenants/:id/status` took a free-text `reason` that landed in `tenant_events.detail`, which the tenant-facing `GET /v1/tenants/events` passes through verbatim — so whatever an operator typed was readable by anyone holding that tenant's API key. Same problem migration 068 solved for `payments.rejection_reason`, same fix: `src/constants/suspension-reasons.js` (`PAYMENT_REVERSED`, `FRAUD_SUSPECTED`, `TERMS_VIOLATION`, `VOLUNTARY_CLOSURE`, `UNPAID_BALANCE`, `OTHER`), validator-whitelisted *and* service-re-checked, required only when the target status is `SUSPENDED`.

Written to both `tenants.suspension_reason_code` (current state, cleared on any non-`SUSPENDED` transition) and the `STATUS_CHANGED` event detail as `reasonCode` (history survives reactivation). The column exists because a frontend showing a suspended tenant *why* needs the current reason, not the newest `STATUS_CHANGED` row dug out of an audit log — the same denormalized-cache-alongside-audit-trail pattern as `tenants.agreement_accepted_at`/`agreement_version`. Surfaced on `GET /v1/tenants/me` via `apiKeyModel.findByKeyHash`'s existing tenant join.

`VOLUNTARY_CLOSURE` is not punitive: the product has no separate "closed" status, so an account-closure request (terms-of-service.md §10) lands in `SUSPENDED` too and must not be worded like a sanction.

## Consequences

### Positive
- A tenant who pays gets what they paid for immediately. An SRI outage or a slow operator no longer costs the customer access.
- The pipeline is substantially smaller: four near-duplicate `*IfLinked` functions and a periodic reconciliation scan collapse into one `applyVerifiedPayment`, and one step disappears from the daily subscriptions job.
- Money coming back is now a supported, correct operation rather than a manual tier edit that silently desynced `subscriptions.tier` from `tenants.subscription_tier`.
- Suspension reasons are stable codes the frontend localizes, instead of operator prose shown verbatim to the customer.

### Negative / trade-offs
- **The invoice obligation now depends on the operator working a queue.** Nothing forces it. This is the deliberate trade: the forcing function moves from "the customer is locked out" to "the operator has a visible list," which is the correct place for it, but it is a weaker mechanism and needs the admin UI to actually surface `count`.
- **Reversal detection remains manual.** Neither SPI nor a card rail notifies us; the refund endpoint only handles the response once a human notices. This is a property of the payment rails, not of this design.
- Payments applied before migration 090 have no `applied_from` snapshot and cannot be refunded through the endpoint.

### Neutral
- `PAYMENT_RECEIVED`/`INVOICE_PROCESSING` linger as legacy status values. Harmless, but they will read as live states to anyone skimming the CHECK constraint without this ADR.
