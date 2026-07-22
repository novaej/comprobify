# ADR-021: Synchronous, Certificate-Verified Account Recovery

## Status
Accepted

## Date
2026-07-21

## Context

`POST /v1/register` originally doubled as an implicit recovery mechanism: submitting the registration form again with an already-registered email revoked the tenant's current sandbox API key and returned a fresh one. This had two problems, found during a routine legal-document review (checking the Privacy Policy's claim about "account recovery mechanisms available in the Service"):

1. **Unauthenticated credential issuance.** The email match alone triggered key revocation and reissue — no password (tenants have none by design), no certificate check, no email-ownership proof. Anyone who knew a tenant's registered email could hijack their sandbox key and simultaneously lock out the legitimate holder.
2. **Account enumeration**, even after a first-pass fix required the uploaded P12's certificate fingerprint to match the one on file: a mismatch returned a distinct `403`, while a genuinely unregistered email proceeded through normal registration (`201`). The two cases were trivially distinguishable, so a caller could confirm whether an email had an account without ever proving they owned it.
3. **A hardcoded-environment bug**, found while fixing (1): the recovery branch always revoked/reissued a **sandbox** key regardless of the tenant's actual environment. A tenant already promoted to production, whose *production* key was the one they'd actually lost, got back a useless sandbox key.

Closing (2) properly required deciding what "recovery" should look like as its own designed flow, not an implicit branch of registration.

## Decision

Recovery is a dedicated, single, synchronous endpoint: `POST /v1/recover`.

- **`register()` no longer inspects existing accounts at all.** Any email match is a plain `409 CONFLICT` pointing the caller at `/v1/recover`. This is what makes the enumeration fix possible — `register()` never again has to decide "is this a duplicate or a recovery attempt," so it can't leak that decision.
- **`recover()` parses the uploaded certificate *before* any tenant lookup.** Certificate errors (corrupt file, wrong password, expired) are validated first and propagate normally — they're independent of whether the email is registered, so they never correlate with account existence.
- **Every non-owning outcome returns the identical generic response**: an unregistered email, a tenant with no issuer (inconsistent state), and a certificate that doesn't match the one on file are all indistinguishable from the caller's perspective — same `200`, same body shape, no key.
- **A genuine certificate match issues a key synchronously**, in the same request/response cycle — the same ownership bar fresh registration already accepts (possessing the correct SRI-issued P12). Environment is resolved from the tenant's actual `sandbox` flag, fixing bug (3) above.
- **A fire-and-forget notification email reuses the existing verification-token machinery** (`tenantModel.updateVerificationToken` + `emailService.sendVerificationEmail` + `GET /v1/verify-email`) rather than a parallel token/email/redemption system. This is a pure notification side-channel — it does not gate the key already issued, and is a harmless no-op if clicked by an already-`ACTIVE` tenant.
- **Account suspension is only ever revealed to a caller who already proved ownership** via a matching certificate. A caller with the wrong certificate gets the generic response and learns nothing about status.

## Consequences

### Positive
- Closes both the credential-theft and enumeration gaps with no new database schema — no new `TenantStatus` value, no new token columns, no migration.
- Recovery has the exact same trust bar as registration (possession of the SRI-issued certificate), so the two flows are conceptually and operationally consistent — no separate "is this proof of ownership strong enough" question to answer twice.
- Fixes a real, previously-shipped bug (hardcoded sandbox environment) as a natural consequence of the redesign, not a bolt-on.

### Negative
- Recovery is synchronous and returns a live credential in the same response that received the certificate — a corporate email/link scanner is not part of this flow at all (no link is emailed that itself grants access), but the notification email's verification link, if clicked by an automated scanner before the real user, would harmlessly re-activate an already-active tenant — negligible impact given verification never carries a credential.
- The response for a real match legitimately differs in shape from every other outcome (it contains `tenant`/`issuer`/`apiKey`/`environment`). This is by design — a matching certificate is proof of ownership, not something to hide — but it is worth stating explicitly: enumeration resistance holds only among non-owning callers, not as a guarantee that the endpoint's behavior is uniform in all cases.

### Mitigation
- `docs/site/endpoints/recover.md` (and its English counterpart) document the anti-enumeration behavior explicitly, so integrators don't mistake the generic response for a bug or an unreliable endpoint.
- `NEXT_STEPS.md` item 11 (Generic Repeated-Attempt / Anomaly Detection) lists registration recovery as its first wire-up target, for detecting unusually frequent legitimate recoveries (which could indicate a compromised certificate being reused) — a separate, later concern from the enumeration fix itself.

### Alternatives Considered
- **Two-step initiate/confirm flow** (a `POST /v1/recover` that only sends a token by email, plus a separate `GET /v1/recover/confirm?token=` that actually issues the key): this was the initial design direction, modeled on a mistaken assumption that `GET /v1/verify-email` carries the same credential-exposure risk as the old recovery branch. It doesn't — verification only ever flips `status`, never issues a key, so email verification and credential issuance have always been decoupled in this codebase (`register()` returns the API key synchronously, before the tenant has verified anything). Given that precedent, gating recovery's key issuance behind a second async step would have been *more* cautious than registration itself, for no clear benefit, at the cost of new schema (a dedicated token/status/redirect-URL column set), a new email template, and a corresponding two-step UI flow in `comprobify-web`. Rejected in favor of matching registration's own synchronous trust model.
- **Keeping recovery inside `POST /v1/register`** (the status quo, with only the certificate-match requirement added): rejected because the enumeration leak is structural to a single endpoint that has to silently branch on whether an account already exists — as long as that branch exists, its two outcomes are distinguishable by construction (a `201` new-tenant response can never be made to look like a `403`/`200` existing-tenant response without changing what registration itself returns). Splitting the endpoints was the only way to let `register()` stop making that decision at all.
- **POST instead of GET for a would-be confirm step**: considered and rejected together with the two-step design above, once the two-step approach itself was rejected as unnecessary — the concern that motivated it (an email-scanner prefetch silently consuming a credential-issuing link) doesn't apply here, because no such link is ever emailed; the notification email's link only re-verifies an already-decided status.

## Addendum (2026-07-22): forced re-verification as extra validation

The original decision treated the notification email as a pure side-channel — it never gated the key already issued, and clicking it was a harmless no-op for an already-`ACTIVE` tenant. In practice this meant a matching certificate was the *only* factor recovery ever checked; email possession was informational, not required.

`recover()` now also durably demotes the tenant to `PENDING_VERIFICATION` (`tenantModel.demoteToPendingVerification()`, the direct counterpart of `activate()`) with the same fresh token it already generates for the notification email, instead of leaving `status` untouched. This adds a genuine second factor on top of the certificate: recovering full account privileges now requires proving control of the registered email inbox too, not just possession of the P12. The reasoning for treating a certificate match as sufficient to issue a key synchronously (the original decision above) is unchanged — a stolen P12 alone still doesn't get an attacker anything beyond a `PENDING_VERIFICATION`-scoped key.

**Scope of the restriction:** identical to a freshly-registered tenant, since it's the exact same status value with the exact same gates already enforced elsewhere (`issuer.controller.js`, `tenant.service.js`, `subscription.service.js`, `api-key.service.js` all check `tenant.status !== ACTIVE`). The reissued key works immediately for sandbox document creation; branch creation, promotion to production, starting a subscription, and minting additional named keys are blocked until the link is clicked. No new status value, no new gate — this reuses machinery that already existed for a different purpose (onboarding), rather than inventing a recovery-specific restricted state.

**Why not skip the demotion when `EMAIL_PROVIDER=none`:** `register()` already unconditionally sets new tenants to `PENDING_VERIFICATION` regardless of whether an email can actually be sent (only the send attempt itself is conditional) — a tenant stuck this way today is already a known, accepted shape, recoverable via `POST /v1/admin/tenants/:id/verify`. Making `recover()`'s behavior depend on email configuration would mean the *strength* of account recovery's validation varies by deployment, which is a worse property than occasionally requiring an admin's manual unstick in an environment that has no email provider configured at all (chiefly local development — every real deployment requires `MAILGUN_*` config per `src/config/validate.js`).

This changes the "Negative" consequence above about the notification email being a harmless no-op — it no longer is. Clicking (or not clicking) the link now has a real effect on the account's capabilities, which is the intended behavior, not a regression: it's the point of adding this as extra validation.
