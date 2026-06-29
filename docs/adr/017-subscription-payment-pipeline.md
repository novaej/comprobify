# ADR-017: Manual Subscription/Payment Pipeline with Invoice-Gated Activation

## Status
Accepted

## Date
2026-06-28

## Context

Comprobify needed a way to bill tenants for paid subscription tiers before any payment gateway exists. Kushki (the intended long-term gateway) is blocked — it requires a registered legal entity, which doesn't exist yet, and every compliant card processor has the same requirement, so this isn't a Kushki-specific blocker. The near-term need was a manual flow: track a tenant's subscription and a bank transfer (SPI) by hand, then self-bill the tenant through Comprobify's own document-creation API, using the tenant as the buyer on a real invoice issued from the operator's own RUC.

This raised a question specific to this product: when does a subscription actually become active? The obvious answer — "once payment is confirmed" — has a gap. Comprobify exists to give other businesses a reliable, audited invoicing pipeline; granting paid API access against a payment with no valid legal invoice behind it would be exactly the kind of gap this product is supposed to close for everyone else.

A second design question was where tier selection should live. `POST /v1/tenants/promote` already existed as the one-way sandbox→production transition. Registration (`POST /v1/register`) is the low-friction entry point that should stay frictionless.

## Decision

**Activation is gated on SRI authorization, not payment.** A `subscriptions` row only reaches `ACTIVE` once its linked invoice document reaches `AUTHORIZED` status. `document-transmission.service.js`'s `checkAuthorization()` fires `subscriptionService.activateIfLinked(documentId)` fire-and-forget on every authorization — the same pattern already used for the existing notification/email side effects on that function, not a new generic event mechanism. It's a no-op for the overwhelming majority of documents, which aren't linked to any subscription.

**Tier selection happens at promotion, not registration.** `POST /v1/tenants/promote` gained optional `tier`/`billingInterval` fields. Promotion itself (the sandbox→production flip, API key rotation) always proceeds immediately regardless of whether a tier was requested — production access on FREE is never gated on payment. This mirrors a decision already made earlier for the eventual Kushki integration ("collect the card at promote, not at registration") and generalizes it: promotion is the moment real risk and billing start; registration stays a frictionless trial entry point.

**One subscription, many payments.** `subscriptions` and `payments` are separate tables (`subscription_id` FK), so a renewal is a new `payments` row against the same long-lived subscription, not a new subscription. `findActiveOrPendingByTenantId` blocks creating a second subscription while one is already in flight.

**The tenant uploads proof; the operator makes one decision.** `PATCH /v1/payments/:id/proof` is tenant-facing (the tenant's own API key, ownership-checked through `subscription.tenant_id`) and accepts a multipart file (PNG/JPEG/GIF/PDF, 2 MB max), mirroring the existing `issuers.logo` BYTEA storage pattern. The operator reviews it via `GET /v1/admin/payments/:id/proof` and decides with **one** endpoint, `PATCH /v1/admin/payments/:id/review` (`{ decision: "VERIFIED" | "REJECTED" }`) — initially built as two separate `verify`/`reject` endpoints, consolidated after recognizing they're one decision with two outcomes, not two distinct actions with different inputs or permissions.

**No payment-gateway-specific schema until a gateway is decided.** `subscriptions`/`payments` were briefly given `kushki_subscription_id`/`kushki_customer_id`/`kushki_charge_id` columns "for later," then removed — Kushki is blocked indefinitely and not even contractually committed to, so carrying vendor-shaped dead columns for a guess was premature. Whichever gateway is eventually chosen gets its own dedicated migration at that point.

**Pricing lives in `subscription-tiers.js`, not duplicated elsewhere.** `priceMonthlyUsd`/`priceYearlyUsd` (yearly = monthly × 10, 2 months free) sit alongside the quota/limits fields they're priced against. A public `GET /v1/tiers` (no auth, no rate limiter) exposes the same catalog so a future pricing page reads from one source instead of hardcoding the numbers a second time.

## Consequences

### Positive
- A tenant can never end up with a paid tier and no valid legal invoice behind it — the one failure mode this design specifically closes.
- Production access is never blocked on a payment review cycle; a tenant promoting with a paid tier keeps working on FREE limits until the upgrade lands.
- The Kushki integration (once unblocked) bolts onto the same schema and the same `createSubscription`/`activateIfLinked` functions — only the payment-collection step (steps 2-3 of the flow) changes, from a tenant upload + operator review to a webhook.
- `review` being one endpoint instead of two halves the admin API surface for that action and matches how an operator actually thinks about it ("approve or reject this proof").

### Negative
- The activation hook is fire-and-forget inside an existing service function rather than a generic event system — adding a second consumer of "subscription activated" later means either growing that function or introducing an abstraction at that point, not before.
- There's no tenant-facing read endpoint for subscription/payment status yet (NEXT_STEPS.md #12) — a tenant currently has to poll `GET /v1/tenants/me` and infer completion from `subscriptionTier` changing, with no visibility into the in-between states or rejection reasons.
- Renewals are schema-ready (`payments.period_start/end` stamped per cycle) but not automated — there's no job that initiates a new billing cycle when one ends (NEXT_STEPS.md #10).

### Mitigation
The fire-and-forget hook follows the exact precedent already in `document-transmission.service.js` (notification + email side effects), so it's a one-line addition to a pattern reviewers already understand, not a new pattern to learn. The missing tenant-facing status endpoint and renewal automation are both explicitly tracked in NEXT_STEPS.md rather than silently deferred, and both are additive — building them later doesn't require changing anything already shipped.

### Alternatives Considered
- **Activate on payment confirmation alone**: simpler, one fewer state, no dependency on the document pipeline. Rejected — this is the exact gap (paid access with no valid invoice) the product exists to prevent for everyone else.
- **Generic event-bus/listener architecture** (so future consumers of "payment verified" / "subscription activated" don't require touching this code): this codebase has no event bus anywhere else — every cross-cutting effect (notifications, webhooks, email) is a direct fire-and-forget call at the point of the state change. Introducing a new abstraction for one flow, before a second consumer exists that needs it, was rejected as premature.
- **Tier selection at registration**: considered and initially built, then reversed — it conflicts with the already-decided principle that billing-relevant actions happen at promotion, and would have meant two different places a tenant could end up mid-payment-flow.
- **Speculative Kushki columns now**: rejected after building them — Kushki isn't contractually committed, only "intended," and carrying unused vendor-shaped columns contradicts the project's "don't design for hypothetical future requirements" norm.
- **Separate verify/reject endpoints**: initially built, mirroring this codebase's `addDocumentType`/`removeDocumentType`-style pattern for opposite actions. Reconsidered — unlike those pairs, verify/reject share the same input (the uploaded proof) and the same permission level; they're one decision, not two actions, so one endpoint with a `decision` field fits better.

## Addendum (2026-06-29): subscriptions decoupled from promotion

The "tier selection happens at promotion" decision above assumed a tenant would only ever want to start paying at the same moment they leave sandbox. In practice nothing in the pipeline actually depends on `tenant.sandbox` — `createSubscription`, the proof/review cycle, and `activateIfLinked`'s tier/quota grant all run identically regardless of environment; quota enforcement itself only applies to production document creation, so granting a tier early has no effect until promotion happens anyway.

`POST /v1/subscriptions` now lets a tenant start a subscription on its own, gated only on `tenant.status === ACTIVE` (the same email-verified check `promote()` already used) — including while still in sandbox. `tenant.service.js`'s `promote()` checks for an already-`ACTIVE` subscription before honoring its own `tier`/`billingInterval` fields: if one exists, tier selection is skipped entirely and the existing subscription is surfaced in the response instead. The promote-time `tier` fields stay, for a tenant who didn't pre-subscribe and wants to do both in one call — this is additive, not a reversal of the original decision.

This also closes a side gap: previously, a tenant who promoted on FREE (or already promoted before this change shipped) had no path back into the subscription pipeline at all, since `requestTierChange` requires an existing `ACTIVE` subscription. `POST /v1/subscriptions` is the general entry point now; promotion is just one of two places that can reach it.
