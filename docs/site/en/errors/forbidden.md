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

### `EMAIL_VERIFICATION_REQUIRED`

The operation requires email verification to have been completed. This blocks:
- Creating additional branches (`POST /v1/issuers`)
- Promoting to production (`POST /v1/tenants/promote`)
- Minting new API keys (`POST /v1/keys`)

**What to do:** Check the inbox for the original verification email, or request a new one via `POST /v1/resend-verification`. Then retry the original operation.

### `PRODUCTION_KEY_REQUIRES_PROMOTION`

A production API key can only be created if the tenant has already promoted to production at least once. Before promotion, only sandbox keys can be minted.

**What to do:** Call `POST /v1/tenants/promote` to promote the tenant to production. Production keys will be issued automatically as part of that response. Additional production keys can be minted afterwards via `POST /v1/keys`.

### `INSUFFICIENT_SCOPE`

The API key making this request doesn't carry the scope the target endpoint requires. Every key has a `scopes` array (`documents:write`, `documents:read`, `issuers:read`, `issuers:write`, `keys:manage`, `billing:manage`, `webhooks:manage`, `tenant:manage`, `tenant:promote`) — see [API Keys → Scopes](/endpoints/api-keys#scopes) for the full vocabulary and which routes need which scope. A key minted without an explicit `scopes` field has all nine (full access); this error only happens with a deliberately narrowed key.

**What to do:** Either mint a new key with the required scope included, or use a different, broader key you already hold for this call.

### `SCOPE_ESCALATION_FORBIDDEN`

Only returned from `POST /v1/keys`. You tried to mint a new key with a scope your own key doesn't hold — a key can never mint one broader than itself, even with `keys:manage`. See [API Keys → Mint a new key](/endpoints/api-keys#mint-a-new-key) for the privilege containment rule.

**What to do:** Only request scopes your own key already has, or omit `scopes` entirely to clone your own key's scopes onto the new one.

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
