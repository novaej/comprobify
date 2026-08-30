# ADR-028: Card Payments via Payphone's Cajita de Pagos

## Status
Accepted

## Date
2026-08-24

## Context

Until now the only way to pay for a subscription was a manual SPI bank transfer: the tenant uploads a screenshot of the transfer, the operator opens it, compares it against the bank, and clicks verify. That is slow for the tenant (hours to days), and it does not scale for the operator — every single payment, including every monthly renewal, needs a human to look at an image.

[ADR-027](027-decouple-activation-from-invoice.md) had already removed the *other* human step: a verified payment now grants access immediately, and `subscriptionService.applyVerifiedPayment(payment, subscription)` is the single place that happens, dispatching on `payment.purpose`. That left the review itself as the only remaining bottleneck, and made adding a self-verifying payment method substantially smaller than it would have been before: an approved card charge simply calls the same function a verified transfer does.

Payphone is the practical choice for Ecuador. It offers three integration products — an embedded JS widget (*Cajita de Pagos*), a redirect button, and payment links.

## Decision

**Add card payment via Payphone's Cajita de Pagos as a second method alongside SPI transfer. Both remain first-class; neither replaces the other.**

### The Cajita, and where the split falls

The widget was chosen over the redirect button and payment links because comprobify-web is the only consumer — this is not a capability the API offers tenants for their own customers — and keeping the payer on the page is the better checkout experience.

This is money flowing **to the operator**, never through it: a tenant pays their own Comprobify subscription. It is not a payment-collection feature for the tenant's customers, and cannot become one by accident — `createSession` resolves its amount from an existing `payments` row owned by the caller, and nothing in the request can name a payee or an amount.

A consequence worth stating, because it was initially got wrong: **these endpoints are deliberately excluded from the public docs site and the tenant-facing Postman collection.** The widget only renders on the domain registered in Payphone's console, so a third-party integrator could successfully mint a session over the API and then find the widget won't load — documentation promising a flow the reader cannot complete. Integrators pay by SPI transfer; the card endpoints are documented in `docs/guides/payphone-payments.md` and the internal collection instead.

That said, **the API owns the money truth**. comprobify-web renders the widget and hosts the return page Payphone redirects to, but the `POST /api/confirm` call — the thing that actually captures the charge and requires the secret token — is server-side here, and every state transition lands in `payments` / `payphone_transactions`. The frontend's return page does nothing but forward two query parameters immediately on load.

**Payphone auto-reverses any charge not confirmed within 5 minutes.** That single constraint shapes the whole design: the return page must not defer confirm behind a click, and there must be a reconciliation path for every way those five minutes can be missed.

### Every payment purpose is card-payable

`INITIAL`, `TIER_CHANGE`, and `RENEWAL` alike. It is one endpoint either way since `applyVerifiedPayment` already dispatches on purpose, and renewals benefit most — that is the flow a tenant would otherwise repeat, with a screenshot, every single month.

### One row per attempt

`payphone_transactions` records an attempt, not a payment. A declined card is retried and the failed attempt stays as audit trail — the same append-only reasoning as `payment_proofs`. Statuses: `PENDING`, `APPROVED`, `CANCELLED`, `EXPIRED`, `DUPLICATE`, `ERROR`.

### The confirm transaction holds its lock across the vendor call

`SELECT ... FOR UPDATE` on the attempt row, held while Payphone is called. This follows `pendingEffectService.process()`, which already holds its claim across handler work including SRI SOAP calls, and it is what makes a double-submitted return page safe: the second request blocks, then sees a terminal row and never issues a second confirm. The 10-second timeout bounds the lock.

### A transport failure is not a decline

The vendor client (`payphone.service.js`) never throws, mirroring `webhook-delivery.service.js`'s `attemptDelivery`. The distinction it preserves is load-bearing: "the network failed, so this charge is **unresolved**" must not collapse into "Payphone said no". An unresolved attempt stays `PENDING` for reconciliation. Recording it as declined would strand real money.

### Two-phase commit, and the gap it leaves

The vendor outcome commits **before** `applyVerifiedPayment` runs. A crash in between therefore leaves money captured, the attempt `APPROVED`, and the payment still `PENDING` — the tenant paid and got nothing.

Threading the confirm transaction's client all the way through `applyVerifiedPayment` would close this properly, but that function reaches `tenantModel`, `tenantQuotaService`, `tenantEventModel`, `notificationService`, and `pricingService`, none of which accept a client. Rather than invert that ownership for one caller, the gap is recorded and swept: `payphone_transactions.applied_at` marks the second phase, and the reconciliation job re-applies anything `APPROVED` with `applied_at IS NULL`. This is the same philosophy the `pending_effects` outbox already uses — durable record first, effect second, sweep for the difference.

### Duplicate charges are flagged, never applied twice

A tenant with two tabs open can complete the widget twice, producing two real charges against one payment. The second confirm finds the payment already `VERIFIED`: the attempt is marked `DUPLICATE` and **not** applied, because applying twice would double-extend a period or double-flip a tier. It is raised via `logger.error` and `Sentry.captureMessage`, because it is real money that needs refunding by hand. Automating the reversal is deliberately out of scope — Payphone's reversal API is same-day-only, and ADR-027 already established that reversal handling stays manual.

### An operator email, for card payments only

A card payment verifies itself, so nothing would otherwise tell the operator an invoice is now owed. `PAYMENT_VERIFIED_OPERATOR_EMAIL` (the 9th `pending_effects` type) fires on the card path only. SPI payments deliberately do not send it: the operator clicked "verify" themselves and already knows. The payment appears in `GET /v1/admin/invoicing/pending` either way, with no card-specific code, because that queue is simply "verified and not yet invoiced".

### Two rules only the vendor's validator could tell us

Probing Payphone's `Prepare` endpoint with real `toAmountBreakdown()` output before any frontend existed confirmed the amount mapping, and surfaced a rule absent from their integration docs: **charges under $1.00 are rejected** (`errorCode 107`). That is reachable — `requestTierChange` applies a $0 proration for free, but $0.01–$0.99 opens a real payment row. `createSession` refuses those with `400 PAYPHONE_AMOUNT_BELOW_MINIMUM` so the frontend can fall back to transfer, rather than letting the tenant hit an untranslatable vendor error at submit.

Separately, **"transaction not found" comes back as HTTP 404 with a structured body**. That is semantic, not routing — a status-first reading misreports a working host as a broken one.

### Attempts are never reused

Each `createSession` mints a fresh `clientTransactionId` and row. A `PENDING` row with no vendor id is ambiguous between "the payer closed the widget" (Payphone never saw the id) and "the payer paid and the redirect never arrived" (Payphone saw it and may be holding a charge), and nothing on our side distinguishes them. Reusing the id in the second case is a duplicate submission against a live transaction, against Payphone's own uniqueness requirement. A ceiling of 10 unresolved attempts per payment bounds the cost instead.

The same ambiguity is why the transport-failure path must persist Payphone's transaction id while leaving the attempt `PENDING`: that id only arrives on the return redirect, and without it a captured-but-unacknowledged charge cannot be looked up again and is silently lost.

### Reversal stays manual, for both methods

`PATCH /v1/admin/payments/:id/refund` rolls back our state and moves no money. Payphone does expose a reverse API and we now have working credentials, so automating the card side would be small — but it was deliberately left out.

An SPI reversal cannot be automated at all (no rail notifies us, and the money moves through a bank we don't call), so automating card alone would produce two different procedures for the same operator decision. Payphone's reverse API is also same-day-only, until 20:00 EC, so it would cover the narrow "noticed today" case and leave every chargeback and late discovery on the manual path regardless.

The cost is an ordering hazard the docs have to carry: money first, then our side. Reversed, a failed dashboard reversal leaves a tenant downgraded but still charged, and nothing detects the mismatch.

Worth revisiting if duplicate charges become common — that is the one case where automation fits well, since it is caught immediately by the alert and is always same-day.

### Optional infrastructure

`PAYPHONE_TOKEN`/`PAYPHONE_STORE_ID` follow the `REDIS_URL`/`SENTRY_DSN` pattern: empty-string defaults, deliberately absent from `src/config/validate.js`. Unset means the card endpoints return `503 PAYMENT_GATEWAY_NOT_CONFIGURED` and SPI is untouched. An environment without Payphone credentials is a supported configuration, and a vendor outage or a misconfigured deploy can never take billing down with it.

## Consequences

### Positive
- A tenant can pay and be active in seconds, with no screenshot and no waiting on a human.
- Renewals stop requiring a monthly manual ritual from both sides.
- The subscription lifecycle learned nothing new — both methods converge on `applyVerifiedPayment`, so purpose handling, period math, and refund rollback are shared rather than duplicated.
- Refunds already work for card payments with no extra code: `PATCH /v1/admin/payments/:id/refund` reads `payments.applied_from`, which the card path writes via the same shared function.

### Negative / trade-offs
- **The Payphone token is visible in the browser.** Unavoidable with the Cajita — the widget takes it as init config. It is minted per-session by the API rather than baked into the frontend bundle, so it is centrally rotatable and only handed to an authenticated tenant, but it is not secret from a determined tenant.
- **The two-phase gap is real**, not eliminated. It is bounded by the reconciliation cadence (~5 minutes) rather than made impossible.
- **A missed confirm depends on cron.** If the reconciliation job stops running, unresolved attempts accumulate silently. The job being registered in `terraform/modules/droplet/cloud-init.yaml.tftpl` — not just documented — is what prevents that.
- **Reversal detection remains manual**, as with SPI. Payphone documents no notification for cardholder chargebacks.

### Neutral
- Payphone's *External Notification* webhook (requires prior authorisation from them) would replace the first reconciliation sweep with a push. Worth requesting; it would slot in as a signature-verified route mirroring `verify-mailgun-webhook.js`. Whether it also covers reversals decides whether reversal detection can ever be automated.
