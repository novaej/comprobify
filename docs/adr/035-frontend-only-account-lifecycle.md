# ADR-035: Account Creation, Recovery, and Activation Are Frontend-Only

## Status
Accepted

## Date
2026-09-08

## Context

`POST /v1/register`, `POST /v1/recover`, `POST /v1/resend-verification`, and the consuming `POST`/`GET /v1/verify-email` were all public, unauthenticated routes — by design, since a brand-new tenant has no API key yet to authenticate with. `docs/site/getting-started.md` documented them as something any third-party developer could call directly with `curl`, and the legacy combined `GET /v1/verify-email` existed specifically as a fallback for "a direct API caller bypassing a first-party frontend."

That design was revisited while working through ADR-034's reserved-key-pool mechanism. A real end user should only ever create a Comprobify account through the comprobify-web UI — a raw API-first signup flow was never a real product requirement, and leaving these routes open publicly means:
- Anyone can hit `registrationLimiter`'s budget and attempt account creation directly, with no product surface in front of it.
- The "self-service keys/webhooks are a paid feature" story from ADR-034 is undermined at its root — nothing stopped a script from registering accounts directly and never touching comprobify-web at all, making the whole "reserved for the frontend" framing moot for that tenant.
- The public API docs described a signup flow that the product never actually wants a third party to use standalone.

## Decision

`POST /v1/register`, `POST /v1/recover`, `POST /v1/resend-verification`, and `POST /v1/verify-email` (consuming) now require a valid `X-Internal-Service-Secret` header, checked by a new `requireInternalService` middleware (`src/middleware/require-internal-service.js`) mounted first, ahead of `registrationLimiter` and any file upload/body parsing. A request without the header, or with the wrong value, is rejected with `403 INTERNAL_SERVICE_ONLY` before any other work runs. Repeated wrong-secret attempts are recorded via `attemptTrackerService` (`AttemptEventTypes.INTERNAL_SERVICE_AUTH_FAILURE`), mirroring `authenticate-admin.js`'s and `verify-mailgun-webhook.js`'s existing pattern of only counting a *presented-but-wrong* credential, not a bare missing one (avoids noise from routine unauthenticated scans).

This reuses the exact secret already defined for `trusted-forwarded-ip.js` (`INTERNAL_SERVICE_SECRET`) — the same trust boundary, now load-bearing for two purposes with two different failure modes:
- `trusted-forwarded-ip.js`: optional, degrades gracefully — a missing/wrong secret just leaves `req.ip` as the BFF's own address.
- `require-internal-service.js`: mandatory, fails **closed** — a missing/wrong secret blocks the request outright.

Because of the second point, `INTERNAL_SERVICE_SECRET` moved from optional to **required**, validated in `src/config/validate.js`. Leaving it unset must never silently make registration "still work, just less secure" — it must make registration entirely unreachable, which is a loud, obvious failure an operator will notice immediately rather than a security gap that ships silently.

**The non-consuming `GET /v1/verify-email/check` is the one deliberate exception** — it stays public, ungated. It doesn't create or activate anything (it only reads token validity), and its whole purpose is to be safely callable by anything, including automated email link-scanners that never carry the internal secret.

**The legacy combined `GET /v1/verify-email?token=xxx` is removed entirely**, not gated. Gating it would have made it permanently unusable for its own stated purpose (a real end user's email client can never present `X-Internal-Service-Secret`), so keeping it around gated would just be dead code with a confusing name. `verificationRedirectUrl` — previously optional, falling back to a link at `${APP_BASE_URL}/v1/verify-email?token=...` — is now a **required** field on `POST /v1/register` (`registration.validator.js`), since there is no API-hosted verification page left to fall back to. `recover()`/`resendVerification()` already reused the tenant's own stored `verification_redirect_url` rather than taking a fresh one most of the time, so requiring it once at registration guarantees every later verification email also has a valid link — `email.service.js`'s `sendVerificationEmail()` no longer has (or needs) a fallback branch.

`docs/site/getting-started.md` (es/en) and the endpoint reference pages no longer document `POST /v1/register`/`/recover`/`/resend-verification` as something a third-party integrator calls directly — see "Consequences" below for what replaced that content.

## Consequences

### Positive
- Account creation has exactly one real front door (comprobify-web), matching how the product actually works today — there was never a supported "headless signup" use case.
- Closes the gap ADR-034 flagged: a tenant can no longer come into existence without ever having gone through the frontend, which is what makes the "reserved for the frontend" framing of the API key/webhook pool actually true, not just aspirational.
- `INTERNAL_SERVICE_SECRET` becoming required (rather than silently optional) means a deployment can't accidentally ship with account creation reachable by anyone, or unreachable by everyone, without a loud startup failure telling the operator exactly what's missing.

### Negative / trade-offs
- **Removes a previously-real capability**: a third party wanting to auto-provision Comprobify accounts for their own users via API (e.g. a partner platform embedding Comprobify as a white-labeled invoicing backend) can no longer do that without comprobify-web's involvement. Nothing in the current product roadmap needs this, but it's a deliberate narrowing, not a no-op.
- Every environment (local dev included) must now set `INTERNAL_SERVICE_SECRET` before registration works at all — a fresh clone with an incomplete `.env` fails loudly at startup instead of registration just working out of the box.
- The `X-Internal-Service-Secret` header must be attached server-side by comprobify-web's own backend for every register/recover/resend-verification/verify-email call it proxies on a visitor's behalf — a purely client-side (browser-only) implementation of these calls would leak the secret and defeat the purpose. This is the same assumption `trusted-forwarded-ip.js` already made (comprobify-web is described as a "server-side BFF" elsewhere in CLAUDE.md), so it isn't a new architectural constraint, just a second consumer relying on it.

### Alternatives Considered
- **Leave the routes public, rely on `registrationLimiter` alone.** Already in place before this ADR and insufficient — a rate limit slows abuse, it doesn't express "only our own frontend may call this," and does nothing about the ADR-034 framing gap.
- **A separate, dedicated secret instead of reusing `INTERNAL_SERVICE_SECRET`.** Rejected — it's the same trust boundary (comprobify-web's server-side BFF) as the existing IP-forwarding use case; a second secret for the same caller would be one more thing to provision and rotate for no isolation benefit, since a leak of either secret compromises the same actor's trust level.

## Addendum (2026-09-10): Extended to subscription/payment mutations

The same `requireInternalService` gate now also covers every subscription and payment **mutation**: `POST /v1/subscriptions`, `POST /v1/subscriptions/change-tier`, `POST /v1/subscriptions/seats`, `DELETE /v1/subscriptions`, `DELETE /v1/payments/:id`, `PATCH /v1/payments/:id/proof`, `DELETE /v1/payments/:id/proofs/:proofId`, `POST /v1/payments/payphone/confirm`, `POST /v1/payments/:id/payphone-session` — in `src/routes/subscriptions.routes.js` and `src/routes/payments.routes.js`.

This is a different rationale from the original decision above: registration is gated because it's an *anonymous* action with no tenant yet, making it inherently abuse-prone. A subscription/payment mutation is already tenant-authenticated (`authenticate` + `requireScope('billing:manage')`) before `requireInternalService` even runs — there's no anonymous-abuse vector to close here. The reason for gating billing mutations is a product decision, not a security patch: Comprobify wants subscription/payment changes to always flow through comprobify-web's own checkout/proof-upload UX, the same way account creation always flows through its own signup UX, rather than being a general-purpose billing API a third-party integrator can drive directly.

Concretely, `requireInternalService` is an **additional** gate stacked on top of (not a replacement for) the existing `authenticate` chain — a call to one of these routes must carry both a valid tenant API key (resolving `req.tenant`, same as any Documents/Issuers call) **and** a valid `X-Internal-Service-Secret`. In practice this means comprobify-web's BFF makes these calls using one of its own reserved-for-frontend API keys (see ADR-034's `RESERVED_API_KEYS_FOR_FRONTEND` pool) plus the internal-service header, on behalf of whichever tenant is signed in — not a tenant's own directly-held key calling from outside comprobify-web.

**The 3 read endpoints stay ungated**, on tenant-API-key auth alone — `GET /v1/subscriptions/me`, `GET /v1/payments/:id/proofs`, `GET /v1/payments/:id/proofs/:proofId` — mirroring `GET /v1/verify-email/check`'s exception above: a read doesn't create, change, or charge anything, so there's no UX-consistency reason to force it through the frontend, and a tenant's own backend system (e.g. an accounting integration) may legitimately want to poll its own billing/proof status directly.

Postman: the public collection no longer documents any Subscriptions/Payments endpoints (mutations aren't reachable from outside comprobify-web, and the 3 reads were left out of the public collection as a deliberate scope choice, not a technical necessity — they could be added later). The internal collection's Subscriptions/Payments requests now include an `X-Internal-Service-Secret` header.

## Addendum (2026-09-19): Extended to tenant promotion and legal agreements

`POST /v1/tenants/promote` now carries the same `requireInternalService` gate (`src/routes/tenants.routes.js`), stacked on top of `authenticate` + `requireScope('tenant:promote')`. Same rationale as the billing mutations above: the caller is already tenant-authenticated, so this is a product decision, not a security patch — promotion revokes every sandbox key and mirrors each one into production, and the plaintext of the non-reserved ones is returned in the response. Only comprobify-web's BFF is meant to receive that response and show those keys to the tenant once; a direct caller (possible before this change for a Starter+ tenant that self-minted a key with `tenant:promote`) would have received keys in a flow no frontend UX accompanied. The mirroring behavior itself is unchanged. The `tenant:promote` scope still exists and is still required, but a tenant-held key carrying it can no longer complete the call on its own. Postman: `Promote to Production` moves out of the public collection into the internal one, which now sends `X-Internal-Service-Secret`.

The same day the gate was extended to **every legal-agreement route** — public `GET /v1/agreements` and `GET /v1/agreements/:type` (router-level `requireInternalService` in `agreements.routes.js`, still without tenant auth) and `GET`/`POST /v1/tenants/agreements`, `.../history`, `.../:type`. The strongest reason is acceptance: `POST /v1/tenants/agreements` records `accepted_at`/`ip`/`user_agent` as legal evidence that a human accepted, and only comprobify-web's BFF forwards the visitor's real IP and user agent (`trusted-forwarded-ip.js`); a direct call from an integrator's backend would have recorded the integrator's server as the accepting party. The reads went along for consistency — comprobify-web is the only consumer, and the public docs no longer describe any of these URIs.

Docs: the eight public endpoint pages for these routes (register, recover, resend-verification, verify-email, promote, agreements, agreement-acceptance, tenant-agreements) were removed from `docs/site` (both languages) and replaced by one page, `account-lifecycle.md`, that explains the flows without URIs and documents `INTERNAL_SERVICE_ONLY`. Their request/response contracts moved to `docs/guides/frontend-only-endpoints.md`. Postman: the public collection drops the Agreements requests; the internal collection sends `X-Internal-Service-Secret` on them. `GET /v1/verify-email/check` remains reachable without the secret but is folded into that page rather than documented as an endpoint. **Deploy order:** comprobify-web must send the header on these calls *before* this API change deploys (an extra header is harmless beforehand) — the initial comprobify-web client did not send it on promote or on any agreement read.
