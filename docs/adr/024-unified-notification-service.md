# ADR-024: Unified Notification Service, Per-Channel Preferences, and DB-Backed Email Templates

## Status
Accepted

## Date
2026-07-26

## Context

ADR-023 shipped `PRICE_CHANGE_ANNOUNCED` as a deliberate, scoped preview of a larger cleanup, flagged as a follow-up item rather than solved in full at the time. The gap it previewed: every notification type before this ADR had two separate, loosely-coupled mechanisms for what is conceptually one event —

- **In-app creation** (`notificationModel.create()`) was gated by a single flat `notification_preferences.enabled` per `(tenant_id, type)`, itself only checked by some call sites.
- **Email** was a parallel, separately-triggered `pending_effects` row per type (`PAYMENT_REVIEWED_NOTIFICATION` + `PAYMENT_REVIEWED_EMAIL`, `SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION` + `_EMAIL`, `SUBSCRIPTION_EXPIRED_NOTIFICATION` + `_EMAIL`, `PRICE_CHANGE_EMAIL` — 7 types across 4 events, plus `DOCUMENT_AUTHORIZED_NOTIFICATION` with no email counterpart), rendered from a JS template file pulling strings out of `src/locales/{es,en}.js`, with no preference gate on email at all.

Callers had to know both mechanisms existed and drive them separately. Email templates lived in JS, requiring a code deploy to fix a typo. And nothing distinguished "a tenant can never turn this off" (the actual reason `PRICE_CHANGE_ANNOUNCED` was made unconditional) from "nobody happened to gate this yet."

## Decision

This lands as three phases, each a separate commit on the same branch, each independently tested and smoke-tested before the next started.

### Phase A — Notification catalog + per-channel preferences

`src/constants/notification-catalog.js` is new: `{ [NotificationTypes value]: { supportsInApp, supportsEmail, mandatory } }`, plus `isMandatory(type)`/`supportsChannel(type, channel)` helpers. This is capability *metadata in code* — mirrors how `subscription-tiers.js` holds structural tier metadata in code while only tier *prices* (a genuinely per-instance, historical concern) went to the database in ADR-023. Notification capabilities (which channels a type supports, whether it's mandatory) don't have a history requirement, so they don't need one.

The catalog lives in its own file rather than reshaping `notification-types.js`'s export — dozens of call sites do `NotificationTypes.PAYMENT_VERIFIED` directly; wrapping that export would touch every one of them for no benefit.

`notification_preferences` (migration 077) gains a `channel` column (`'IN_APP'` or `'EMAIL'`), and its primary key becomes `(tenant_id, type, channel)` — replacing the old single flag per `(tenant_id, type)`. `GET`/`PATCH /v1/notifications/preferences` move from `[{type, enabled}]` to `[{type, channel, enabled}]` (breaking; see Consequences). Mandatory types (`PRICE_CHANGE_ANNOUNCED` today) never appear in this list on either side — `isMandatory()` filters them out of what the endpoint accepts or returns, matching what ADR-023 already special-cased by hand before the catalog existed to express it generically.

### Phase B — Unconditional creation + one channel-neutral dispatch effect

**Creation is unconditional for every type now**, not just `PRICE_CHANGE_ANNOUNCED`. Every `notificationService.createX(...)` function inserts (or, for `DOCUMENT_AUTHORIZED`'s aggregation window and the cert-alert upsert, updates) a `notifications` row regardless of preference. `IN_APP` preference no longer controls *existence* — it controls *visibility*: `notificationModel.findActiveByTenantId()` (`GET /v1/notifications`) now filters out any type the tenant has explicitly disabled on the `IN_APP` channel. This is the same trade ADR-023 made for one type, generalized: it's what makes `notifications` itself a reliable ledger, which is also what other tooling (billing audits, support debugging "did we even notify this tenant") can trust exists regardless of what the tenant muted.

Every `createX()` funnels through one new shared function, `dispatchNotification(notification)`:
1. Always durably enqueues `WEBHOOK_FANOUT` (unchanged from before — webhook delivery was never preference-gated and still isn't).
2. If the type's catalog entry has `supportsEmail: true`, stamps `notifications.email_status = PENDING` (new column, migration 078 — mirrors `documents.email_status`) and enqueues **one** `NOTIFICATION_DISPATCH` effect.

`NOTIFICATION_DISPATCH` replaces the 7 old type-specific `*_NOTIFICATION`/`*_EMAIL` effect types (`DOCUMENT_AUTHORIZED_NOTIFICATION` had no email sibling to begin with, so it simply disappears — the in-app row is created synchronously by the caller, no effect at all). It is named for *what it's for* (whatever async channel work a notification still needs) rather than for a specific channel — today that's always email, since in-app is synchronous and webhook fan-out is its own effect, but the name doesn't bake that in. Its handler (`src/effects/index.js`) is what actually checks the tenant's `EMAIL` preference (`SKIPPED` if disabled) before rendering and sending — the preference check happens once, in the one place that dispatches, not duplicated per type.

`pending_effects.effect_type`'s CHECK constraint (migration 078) was reset to the new minimal 8-value list rather than kept append-only for the 7 retired strings — confirmed safe since no production data existed yet at the time this shipped (CLAUDE.md rule #7's "never hard-delete" concern doesn't apply to a constraint on a still-empty table).

**Terminology note, since it's easy to conflate:** `NOTIFICATION_DISPATCH` is an `EffectTypes` value — it drives `pending_effects.effect_type`, the async-outbox mechanism (ADR-022). It is not a `NotificationTypes` value and has nothing to do with `notifications.type`. The two enums are orthogonal; one `NotificationTypes` event (e.g. `PAYMENT_VERIFIED`) may cause a `NOTIFICATION_DISPATCH` effect to be enqueued, but `NOTIFICATION_DISPATCH` itself is channel/mechanism-level, not event-level.

**Deliberate durability trade-off:** notification-row creation moved from "durably queued effect" (never actually true before this ADR — `DOCUMENT_AUTHORIZED_NOTIFICATION` etc. were already just as fire-and-forget) to "synchronous, best-effort, logged-and-swallowed on failure" — the same contract these functions already documented ("never throws"). A crash in the narrow window after the triggering action commits but before the synchronous create call completes loses that one notification with no outbox retry. Accepted because the triggering action itself (a payment review, a renewal, a document authorization) is already durably recorded elsewhere (`payments`, `tenant_events`, `documents`); these are supplementary alerts, not the system's source of truth. `WEBHOOK_FANOUT` and `NOTIFICATION_DISPATCH` — the parts making real external calls worth retrying — stay on the durable outbox, unchanged.

`runCertChecksForTenant()` lost its `prefs` parameter entirely (both call-site pre-fetch in `notification-scheduler.service.js` and the two in-function early-outs) for the same reason — bookkeeping is unconditional now, only the read-time filter matters.

### Phase C — DB-backed, versioned email templates

The 4 remaining JS template files whose notification types support email (`payment-reviewed.js` covering both `PAYMENT_VERIFIED`/`PAYMENT_REJECTED`, `subscription-renewal-due.js`, `subscription-expired.js`, `price-change-announced.js`) are deleted, along with their `src/locales/{es,en}.js` string sections. In their place: `notification_email_templates` (migration 079) — one row per `(notification_type, language, version)`, an `is_current` flag, exactly the same "versioned, immutable, newest-current-row-wins" shape `agreements` (ADR-018-adjacent) already established, keyed by one extra dimension (`language`, since agreements only ever ship in Spanish).

Source content lives in `docs/email-templates/{TYPE}.{lang}.txt` — three sections per file (`SUBJECT:`, `---HTML---`, `---TEXT---`), read at publish time by `notificationEmailTemplateService.publish()`, mirroring `agreement.service.js`'s `publish()` reading `docs/agreements/*.md` (same `.dockerignore` carve-out requirement — CLAUDE.md Common Mistake #32 — applies here too, added for `docs/email-templates`). An admin can also pass `rawContent` directly, same escape hatch `agreements` has for editing without touching the filesystem (CLAUDE.md Common Mistake #34's reasoning applies identically: the deployed container's filesystem is ephemeral).

`{{token}}` substitution was extracted from `agreement.service.js` into a shared `src/utils/template-placeholders.js` (`substitute()` for plain text/subject, `substituteHtml()` which additionally HTML-escapes each interpolated value) — both services now use one implementation instead of two copies drifting apart. Placeholders resolve against a **values object built from `notification.metadata`** (the same JSON already stored at creation time for API/webhook consumers) plus a small set of derived values that genuinely can't be raw metadata: a purpose/rejection-reason *code* → localized *label* lookup (`PURPOSE_LABELS`/`REJECTION_REASON_LABELS` in `notification-email-template.service.js`, per-language, mirroring `notification.service.js`'s own English-only in-app equivalents), a formatted date/amount, and — for `SUBSCRIPTION_RENEWAL_DUE` only — the operator's static bank-transfer config (`config.bankTransfer`, not per-notification data, so it's injected by the service rather than stored in `metadata`).

`notificationEmailTemplateService.render(type, language, notification)` resolves the current template for `(type, language)`, falling back to `DEFAULT_LANGUAGE` (`'es'`) if the tenant's language has no published template — mirrors `src/locales`' own `getTranslations()` fallback — and throws only if neither exists, which the `NOTIFICATION_DISPATCH` handler treats as a real failure (`email_status = FAILED`, rethrown so `pending_effects` retries it) rather than silently dropping the email.

`emailService`'s 4 type-specific `send*()` functions (`sendPaymentReviewed`, `sendSubscriptionRenewalDue`, `sendSubscriptionExpired`, `sendPriceChangeAnnounced`) collapse into one generic `sendNotificationEmail(tenant, rendered)` — rendering (which template, which language, which values) is entirely `notificationEmailTemplateService`'s job now; `emailService` only applies the staging banner and dispatches through the provider, same as its other `send*()` functions.

Admin surface mirrors `/v1/admin/agreements` exactly: `POST`/`GET /v1/admin/notification-email-templates`, `GET .../versions/:id`, `GET .../:type/:language/versions`, `PATCH .../:id/activate`.

## Consequences

### Positive
- One call site per event (`notificationService.createX(...)`) instead of two independently-triggered mechanisms per event.
- `notifications` is now a complete, unconditional ledger for every type, not just the one ADR-023 special-cased — auditing "did this tenant get notified" no longer depends on what they'd muted.
- One effect type (`NOTIFICATION_DISPATCH`) instead of 7, all sharing one preference-check + render + send + `email_status` bookkeeping path — a new email-capable notification type needs a catalog entry and a template, not a new effect type or a new handler branch.
- Email copy is editable (new version, `rawContent`) without a code deploy or redeploy, same operational win `agreements` already has.
- `PRICE_CHANGE_ANNOUNCED`'s "mandatory" special-casing from ADR-023 is no longer bespoke — it's one entry in a catalog every other type also goes through.

### Negative
- Breaking change to `GET`/`PATCH /v1/notifications/preferences`'s body shape (`[{type, enabled}]` → `[{type, channel, enabled}]`) — no versioned API, so this ships as a documented breaking change (CHANGELOG) rather than an additive one. Acceptable pre-1.0 with a small integrator base.
- `render()` throwing when no template is published for a type is a new failure mode that didn't exist when content was baked into JS — mitigated by the `DEFAULT_LANGUAGE` fallback and by the fact that `NOTIFICATION_DISPATCH` failures are retried via reconciliation, not silently lost, but it does mean **every** email-capable type must have at least an `es` template published post-deploy before it can ever send — a one-time manual step (`POST /v1/admin/notification-email-templates` per type/language), same operational precedent as publishing the initial `agreements` versions after that table was introduced.
- A tenant-facing email's exact wording now depends on DB state that isn't in git history the way a JS file's diff was — mitigated by every version being immutable and retained (never hard-deleted, same as `agreements`), so `GET .../versions/:id` is always an audit trail, just not a `git log` one.

### Alternatives Considered
- **Keeping per-type effect types but renaming for consistency (`_NOTIFICATION`/`_EMAIL` → some other consistent split).** Rejected — the actual inconsistency worth fixing was that the effect type baked in a specific channel at all; a single channel-neutral effect scales to a future channel (SMS, push) without inventing another type per channel per event.
- **Keeping email templates as JS files but adding a lookup table for capability metadata only.** Considered as a smaller Phase C — rejected because the user's explicit ask was to fold DB-backed templates into this item now rather than defer them to a separate future item, and the versioned-template infrastructure (`agreements`) already existed to copy the pattern from.
- **Firing `NOTIFICATION_DISPATCH` unconditionally for every notification type, letting the handler no-op for types with no email.** Rejected — `dispatchNotification()` already knows via the catalog whether a type supports email; enqueueing a `pending_effects` row that will just no-op is pure waste, not simplicity.
