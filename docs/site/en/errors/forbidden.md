# Forbidden

**Status:** `403 Forbidden`

The API key is valid and the resource exists, but you do not have permission to perform this operation. Every 403 error carries a specific `code` — use it to handle each case programmatically.

## Codes

### `ISSUER_FORBIDDEN`

The `X-Issuer-Id` header names an issuer that exists but belongs to a different tenant. Each tenant can only operate on its own issuers.

**What to do:** Call `GET /v1/issuers` with the same API key to list your tenant's issuers, then re-issue the request with a valid `X-Issuer-Id`.

### `ACCOUNT_SUSPENDED`

The tenant account has been suspended. Every write request fails until the suspension is lifted, and so does `GET /:accessKey/authorize` (it makes a live SRI call and can send an email). A curated set of other read-only endpoints stays available so you can still see your existing data: listing/downloading your own documents (including RIDE and XML), your subscription and payment-proof history, and your account status/agreements/event log.

**What to do:** Contact support. Suspended accounts cannot self-recover, but you can keep reviewing what's already in your account while the issue is resolved.

### `INTERNAL_SERVICE_ONLY`

The request reached an action reserved for the Comprobify web app: creating the account, verifying the email, recovering it, accepting the legal agreements, going to production, or managing the subscription and payments. The API offers no direct way to do it.

**What to do:** Do that action from the web app. There is nothing to configure in your integration — see [Your account & the web app](../account-lifecycle.md#if-you-see-internal-service-only).

### `EMAIL_VERIFICATION_REQUIRED`

The operation requires email verification to have been completed. This blocks:
- Creating additional branches (`POST /v1/issuers`)
- Promoting to production
- Minting new API keys (`POST /v1/keys`)
- Registering a webhook endpoint or changing its URL or event types

**What to do:** Check the inbox for the original verification email, or request a new one from the Comprobify web app (resending is only done from there — see [Your account & the web app](../account-lifecycle.md#verifying-your-email)). Then retry the original operation.

### `PRODUCTION_KEY_REQUIRES_PROMOTION`

A production API key can only be created if the tenant has already promoted to production at least once. Before promotion, only sandbox keys can be minted.

**What to do:** Promote your account to production from the Comprobify web app (promotion is only done from there — see [Your account & the web app](../account-lifecycle.md#going-to-production)). Production keys are issued automatically as part of promotion, and additional ones can be minted afterwards via `POST /v1/keys`.

### `INSUFFICIENT_SCOPE`

The API key making this request doesn't carry the scope the target endpoint requires. Every key has a `scopes` array (`documents:write`, `documents:read`, `issuers:read`, `issuers:write`, `keys:manage`, `billing:manage`, `webhooks:manage`, `tenant:manage`, `tenant:promote`) — see [API Keys → Scopes](/endpoints/api-keys#scopes) for the full vocabulary and which routes need which scope. A tenant's very first key (minted at registration) always has all nine (full access), but any key minted afterward via `POST /v1/keys` can be narrower — either by explicit request, or because it cloned a narrower key's scopes when `scopes` was omitted (see [Mint a new key](/endpoints/api-keys#mint-a-new-key)). This error happens whenever the calling key lacks the scope the route needs, regardless of how it ended up that way.

**What to do:** Either mint a new key with the required scope included, or use a different, broader key you already hold for this call.

### `SCOPE_ESCALATION_FORBIDDEN`

Only returned from `POST /v1/keys`. You tried to mint a new key with a scope your own key doesn't hold — a key can never mint one broader than itself, even with `keys:manage`. See [API Keys → Mint a new key](/endpoints/api-keys#mint-a-new-key) for the privilege containment rule.

**What to do:** Only request scopes your own key already has, or omit `scopes` entirely to clone your own key's scopes onto the new one.

### `ISSUER_ISSUING_PAUSED`

The issuer is active but has been paused from creating new documents via `PATCH /v1/issuers/:id/can-issue`. Applies to both `POST /v1/documents` and `POST /:accessKey/rebuild` (a rebuild re-signs and re-submits to SRI, the same risk as a fresh create). Documents already issued by this issuer are unaffected — RIDE, XML, and other read-only endpoints keep working normally.

**What to do:** Resume issuing by calling `PATCH /v1/issuers/:id/can-issue` with `{ "canIssue": true }`, or use a different issuer.

### `FORBIDDEN` (fallback)

A generic 403 not covered by a specific code above. Read `detail`.

## Example responses

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "ISSUER_FORBIDDEN",
  "detail":   "Issuer does not belong to this tenant",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "EMAIL_VERIFICATION_REQUIRED",
  "detail":   "Email verification is required before creating additional branches. Check your inbox.",
  "instance": "/v1/issuers"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "INSUFFICIENT_SCOPE",
  "detail":   "This API key does not have the 'keys:manage' scope",
  "instance": "/v1/keys"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "SCOPE_ESCALATION_FORBIDDEN",
  "detail":   "Cannot mint a key with scopes the requesting key does not itself have: tenant:promote",
  "instance": "/v1/keys"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "ISSUER_ISSUING_PAUSED",
  "detail":   "This issue point is not currently allowed to create new documents",
  "instance": "/v1/documents"
}
```
