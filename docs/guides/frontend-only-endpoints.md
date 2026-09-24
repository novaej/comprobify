# Frontend-only endpoints (comprobify-web contract)

These endpoints are **not** callable by third-party integrators. Each one requires a valid
`X-Internal-Service-Secret` header (`requireInternalService`, ADR-035 and its addenda) — a call
without it gets `403 INTERNAL_SERVICE_ONLY` — so in practice only comprobify-web's BFF calls them,
using one of the tenant's reserved API keys plus the header. They used to have public pages on the
docs site; those pages were removed so integrators aren't shown URIs they can't use, and the
integrator-facing explanation now lives in `docs/site/account-lifecycle.md` (with its `en/` mirror)
and `docs/site/paying-your-subscription.md`.

This file keeps the request/response contract for comprobify-web's developers. It covers account
creation, email verification, account recovery, promotion, and legal agreements. The
subscription/payment mutations (also frontend-only) are documented in the source: see
`src/routes/subscriptions.routes.js`, `src/routes/payments.routes.js`, and the internal Postman
collection.

Register, recover, and resend-verification never had their request bodies documented on the public
site; their source of truth is `src/validators/registration.validator.js` and
`src/controllers/registration.controller.js`.

The only endpoint here reachable without the secret is `GET /v1/verify-email/check` (read-only,
consumes nothing).

---

## Register

```
POST /v1/register
```

Creates a tenant, issuer, and sandbox API key in one call.

---

## Verify email

Activates a tenant account using the token from the verification email sent at registration. Once verified, the tenant can promote their account to production.

Verification is split into a read-only check and a separate consuming action. This split exists because email link-scanners (e.g. Microsoft Defender/Safe Links on Outlook addresses) prefetch every link in an email with a plain `GET` before the user ever clicks it — a single combined check-and-consume `GET` let a scanner's prefetch burn the token before the real click happened, leaving the user with an `INVALID_OR_EXPIRED_TOKEN` error on their first genuine click.

### Check token validity (non-consuming)

```
GET /v1/verify-email/check?token=<token>
```

Read-only — safe to call repeatedly, including by automated link-scanners. Never activates the account. Call this on page load to show the user whether their link is still valid before they act on it.

#### Authentication

None — public endpoint. The token in the query string acts as the credential.

#### Query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | string (64-char hex) | Yes | Verification token from the registration email |

#### Response

```json
{ "valid": true, "email": "you@example.com" }
```

or, for an invalid/expired/unknown token:

```json
{ "valid": false }
```

#### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` is missing, not hexadecimal, or not exactly 64 characters |

### Confirming verification

The actual consuming action (`POST /v1/verify-email`) — the one that activates the tenant — is only callable by the Comprobify web app, the same as account creation itself (see Register). It isn't documented here as a third-party-callable endpoint. If you've built your own verification page against `verificationRedirectUrl`, use the check endpoint above to validate the token, then send the user back to the Comprobify web app to actually confirm.

#### Notes

- Tokens expire after the configured TTL (default 24 hours). A fresh verification email is only ever sent by the Comprobify web app.
- The verification email always links to the URL the account was created with (`verificationRedirectUrl`) — there is no API-hosted verification page.
- Verification is a prerequisite for promoting an account to production. Unverified tenants can use the sandbox but cannot switch to production.
- Activating an account logs an `EMAIL_VERIFIED` event to the tenant event log. The non-consuming check above never logs anything.

---

## Resend verification email

```
POST /v1/resend-verification
```

Resends the verification email to a registered but unverified tenant.

---

## Recover account

```
POST /v1/recover
```

Re-establishes the Comprobify web app's link to your account, by matching the P12 certificate used at registration.

---

## Promote tenant to production

Promotes the authenticated tenant from sandbox to production. All branches (issuers) are promoted at once. Sequential counters are seeded for every issuer × document type combination. All active sandbox API keys are revoked and replaced with matching production keys — one per revoked sandbox key, preserving the same label.

```
POST /v1/tenants/promote
```

This is a **one-way** action. Once a tenant is in production, it cannot return to sandbox.

### Authentication

`Authorization: Bearer <api-key>` plus `X-Internal-Service-Secret: <secret>` (web app only)

The tenant's email must be ACTIVE (verified) and all agreements must be ACCEPTED — promotion is blocked if either condition is not met.

### Request body

All fields are optional. An empty body `{}` is valid.

```json
{
  "initialSequentials": [
    { "issuerId": "00000000-0000-0000-0000-000000000001", "documentType": "01", "sequential": 1 },
    { "issuerId": "00000000-0000-0000-0000-000000000002", "documentType": "01", "sequential": 1 }
  ],
  "tier": "STARTER",
  "billingInterval": "MONTHLY"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `initialSequentials` | array | No | Per-issuer, per-document-type starting sequential numbers. Any combination not listed defaults to `1`. |
| `initialSequentials[].issuerId` | string (UUID) | Yes (per entry) | Issuer UUID (from `GET /v1/issuers`) |
| `initialSequentials[].documentType` | string | Yes (per entry) | Document type code, e.g. `"01"` |
| `initialSequentials[].sequential` | integer | Yes (per entry) | Next sequential number to issue (≥ 1) |
| `tier` | string | No | Any paid tier (see current plans and pricing in the Comprobify web app). Omit to stay on FREE in production; promotion never waits on payment either way. Ignored if the tenant already has a subscription in progress (see below). |
| `billingInterval` | string | No | `MONTHLY` (default) or `YEARLY` (2 months free). Ignored if `tier` is omitted or if it's ignored per the above. |

Requesting a `tier` here starts the subscription/payment pipeline (same as the admin-driven path) — see Your subscription & billing for what happens next. The tier/quota upgrade itself lands as soon as the payment is verified; it does not happen as part of this call.

If the tenant already started a subscription before promoting — from the Comprobify web app (see Your subscription & billing), which works while still in sandbox — and it's still in progress by the time this call happens (any status other than `CANCELLED`/`EXPIRED`: `PENDING_PAYMENT` or `ACTIVE`), there's nothing left to select: `tier`/`billingInterval` are ignored entirely, and the response surfaces that existing subscription instead of starting a new one. This is a hard block, not just a courtesy — it prevents a second subscription/payment from being opened while one is already awaiting proof or review.

### Response

**200 OK**

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial master key", "apiKey": "a3f8c2bd..." },
    { "label": "erp-integration",     "apiKey": "d94e17ac..." }
  ],
  "subscription": { "id": "00000000-0000-0000-0000-000000000012", "tier": "STARTER", "status": "PENDING_PAYMENT", "billing_interval": "MONTHLY" },
  "payment": { "id": "00000000-0000-0000-0000-000000000018", "status": "PENDING", "amount": "17.39", "iva_rate": "0.1500", "iva_amount": "2.61", "total_amount": "20.00" },
  "bankTransfer": { "bankName": "...", "accountType": "...", "accountNumber": "...", "accountHolder": "...", "identification": "..." }
}
```

`apiKeys` contains one entry per sandbox key that was active at the time of promotion. The web app receives these tokens and shows you, **once only**, the ones that correspond to named keys you created — copy them then and hand each to the integration that previously used the sandbox key with the same label. Your account's internal key, the one the web app uses to run your dashboard, is never shown.

`subscription`, `payment`, and `bankTransfer` are only present if `tier` was supplied and a new subscription was started. If the tenant already had a subscription in progress going into this call (any status other than `CANCELLED`/`EXPIRED`), only `subscription` is present (no `payment`/`bankTransfer` — nothing new was created). Use `bankTransfer` to show the tenant where to send the SPI transfer, then submit proof of it — see Your subscription & billing.

Sandbox keys are revoked automatically during promotion. If you had no sandbox keys, `apiKeys` will be an empty array — mint production keys via `POST /v1/keys`.

**Subscription period reset:** if the tenant already has an `ACTIVE` subscription (paid while still in sandbox), the billing period (`current_period_start`/`current_period_end`) is automatically reset to the promotion date. This ensures the paid period counts production usage time rather than sandbox testing time.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `tier` or `billingInterval` is not a recognised value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `INTERNAL_SERVICE_ONLY` | Missing or invalid `X-Internal-Service-Secret` header — only the web app can call this endpoint |
| `403` | `FORBIDDEN` | Tenant email not yet verified (status `PENDING_VERIFICATION`) |
| `403` | `AGREEMENT_ACCEPTANCE_REQUIRED` | One or more agreements have not been accepted — call `GET /v1/tenants/agreements` to see which ones, view them at `GET /v1/tenants/agreements/:type`, then accept via `POST /v1/tenants/agreements` |
| `409` | `CONFLICT` | Tenant is already in production |

---

## Agreements (list / view current)

Returns the currently published agreements (Terms of Service, Privacy Policy, DPA). These are the documents a tenant accepts at signup. Use these endpoints to display the documents in your registration flow.

### List current documents

```
GET /v1/agreements
```

**Authentication:** None — public endpoint, no rate limit.

#### Response

```json
{
  "ok": true,
  "documents": [
    { "documentType": "TERMS", "version": "2026-06-28", "url": "/v1/agreements/TERMS" },
    { "documentType": "PRIVACY", "version": "2026-06-28", "url": "/v1/agreements/PRIVACY" },
    { "documentType": "DPA", "version": "2026-06-28", "url": "/v1/agreements/DPA" }
  ]
}
```

The `version` string is what you pass as `termsVersion` in `POST /v1/tenants/agreements`, the explicit acceptance step that follows registration. Always read it from this response rather than hardcoding it — the server validates against whatever is currently published.

### Get a document

```
GET /v1/agreements/:type
```

**Authentication:** None — public endpoint, no rate limit.

**URL parameter:** `:type` must be one of `TERMS`, `PRIVACY`, or `DPA`.

Returns a complete, self-contained `text/html` page — `<!DOCTYPE html>` with its own `<head>`/`<style>` (serif typography, justified body text, a titled/bordered heading hierarchy) — formatted to look like a formal legal document on its own. Best embedded via `<iframe>` or opened as a full page; it is not meant to be injected into an existing page's DOM (e.g. via `innerHTML`), since browsers strip the `<html>`/`<head>`/`<style>` wrapper in that case and the styling would be lost.

#### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `:type` is not a valid document type |
| `404` | `AGREEMENT_NOT_FOUND` | No document of that type has been published yet |

### Notes

- The TERMS and PRIVACY documents together make up the acceptance bundle. The DPA is incorporated by reference in the Terms of Service — there is only one checkbox in the UI, not three.
- The `version` value from `GET /v1/agreements` is an opaque string token. The server does not interpret its format — it just checks that the version you present at acceptance time matches what was current when the user clicked accept.
- If nothing has been published yet, `GET /v1/agreements` returns an empty array and `POST /v1/tenants/agreements` has nothing to accept yet.

---

## Agreement acceptance

Check whether the authenticated tenant needs to re-accept any agreements, and record a new acceptance when they do.

Use this on login/app-load to drive a re-acceptance modal. If `needsAcceptance` is `true`, show the updated documents listed in `outdated` and call `POST /v1/tenants/agreements` when the user confirms.

### Check status

```
GET /v1/tenants/agreements
```

**Authentication:** `Authorization: Bearer <api-key>`

#### Response

##### All current — no action needed

```json
{
  "ok": true,
  "agreements": {
    "needsAcceptance": false,
    "outdated": [],
    "hasPublishedAgreements": true,
    "agreementsEnabled": true
  }
}
```

##### One or more documents updated since last acceptance

```json
{
  "ok": true,
  "agreements": {
    "needsAcceptance": true,
    "outdated": [
      {
        "documentType": "DPA",
        "currentVersion": "2026-07-01",
        "acceptedVersion": "2026-06-28",
        "url": "/v1/tenants/agreements/DPA",
        "acceptUrl": "/v1/tenants/agreements"
      }
    ],
    "hasPublishedAgreements": true,
    "agreementsEnabled": true
  }
}
```

##### No agreement templates have ever been published

```json
{
  "ok": true,
  "agreements": {
    "needsAcceptance": false,
    "outdated": [],
    "hasPublishedAgreements": false,
    "agreementsEnabled": true
  }
}
```

Each entry in `outdated` names the specific document type that changed. Use the `url` to fetch and display the updated document before asking for re-acceptance.

| Field | Description |
|---|---|
| `needsAcceptance` | `true` if any document type has a new template version that isn't yet ACCEPTED |
| `outdated[].documentType` | `TERMS`, `PRIVACY`, or `DPA` |
| `outdated[].currentVersion` | Template version currently published |
| `outdated[].acceptedVersion` | Template version the tenant last accepted, or `null` if never accepted |
| `outdated[].status` | `PENDING` (generated, not accepted), or `NOT_GENERATED` (template published but instance not yet created) |
| `outdated[].url` | URL to the tenant's personalized document instance (`GET /v1/tenants/agreements/:type`) |
| `hasPublishedAgreements` | `false` only when no agreement template has ever been published (a fresh/pre-launch environment) — distinguishes that case from `needsAcceptance: false` meaning "everything's accepted." A `false` value means `outdated` is empty because there's nothing to show yet, not because the tenant is caught up. |
| `agreementsEnabled` | `false` when the operator has switched legal documents off entirely for this deployment. `hasPublishedAgreements` is then also `false`, no instances are generated, and `POST /v1/tenants/promote` does **not** require acceptance. Use it to hide the legal-documents section in your UI: it tells "switched off" apart from "not published yet". |

**Calling this endpoint automatically generates any missing `PENDING` instances** for new template versions — no separate backfill call needed after the admin publishes an update.


::: tip Legal documents disabled
If `agreementsEnabled` is `false`, this deployment runs without Terms, Privacy Policy or DPA. The public agreement endpoints respond as if nothing were published, and promoting to production does not require acceptance. Nothing is deleted: if the operator switches them back on, whatever was already published and accepted is restored.
:::

#### Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

This is a read-only endpoint, so it stays reachable even if the tenant's account is `SUSPENDED` — see the `ACCOUNT_SUSPENDED` entry in the error catalogue.

### Record acceptance

```
POST /v1/tenants/agreements
```

**Authentication:** `Authorization: Bearer <api-key>`

#### Request body

```json
{ "termsVersion": "2026-07-01" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `termsVersion` | string | Yes | The version string from the current TERMS document (from `GET /v1/agreements`). The server validates this against what's currently published before recording anything. |

#### Response

**200 OK**

```json
{ "ok": true }
```

Records one acceptance row per currently-published document type (TERMS, PRIVACY, DPA), capturing the IP address and user agent of the request alongside the version and content hash.

#### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `termsVersion` missing or too long |
| `400` | `VERSION_MISMATCH` | The submitted `termsVersion` does not match the currently published TERMS version — the document was updated between when your UI loaded and when the user clicked accept. Re-fetch `GET /v1/agreements`, show the updated content, and ask for acceptance again. |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Account is suspended |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

### Notes

- Changes to any one of the three documents (TERMS, PRIVACY, or DPA) independently will surface as a mismatch for that type only — the other two won't appear in `outdated` unless they also changed. This means a DPA-only update triggers re-acceptance for the DPA without forcing the tenant to "re-accept" unchanged Terms or Privacy content.
- The API key does not need `X-Issuer-Id` — this is a tenant-level operation.

---

## Tenant agreements (history / view)

View and accept the personalized agreement instances generated for the authenticated tenant. Each document (Terms of Service, Privacy Policy, DPA) is generated with the tenant's own business name and RUC substituted in at registration time — the stored content is an immutable snapshot of what was in effect when the account was created.

Use Agreement Acceptance to check whether any document needs re-acceptance. Use `POST /v1/tenants/agreements` (on that same page) to record acceptance.

### List documents

```
GET /v1/tenants/agreements/history
```

**Authentication:** `Authorization: Bearer <api-key>`

#### Response

```json
{
  "ok": true,
  "documents": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "documentType": "TERMS",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000002",
      "documentType": "PRIVACY",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000003",
      "documentType": "DPA",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    }
  ]
}
```

Returns all instances across all versions, newest first per type. Status is `PENDING` (generated, not yet accepted) or `ACCEPTED`. When a new template version is published, a new `PENDING` instance appears here after the first call to `GET /v1/tenants/agreements` or this endpoint.

### Get a document (rendered HTML)

```
GET /v1/tenants/agreements/:type
```

**Authentication:** `Authorization: Bearer <api-key>`

**URL parameter:** `:type` must be `TERMS`, `PRIVACY`, or `DPA`.

Returns the tenant's personalized document as a complete, self-contained `text/html` page (styled, same formal-document formatting as `GET /v1/agreements/:type` — see its Notes) — the exact content that was stored at generation time, including the tenant's own business name and RUC where applicable (particularly visible in the DPA). A disclaimer notice is prepended pointing to the support inbox for questions before accepting.

Response headers include:
- `X-Document-Status` — `PENDING` or `ACCEPTED`
- `X-Template-Version` — the template version this instance was generated from
- `X-Accepted-At` — ISO timestamp of acceptance (only present when `ACCEPTED`)

#### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `:type` is not a valid document type |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `AGREEMENT_NOT_FOUND` | No template has been published yet for this type |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

Both endpoints on this page are read-only, so they stay reachable even if the tenant's account is `SUSPENDED` — see the `ACCOUNT_SUSPENDED` entry in the error catalogue.

### Notes

- Documents are generated at registration and lazily for any new template version when this endpoint or `GET /v1/tenants/agreements` is called — no separate step is needed to "request" a document.
- Viewing the document does not change its status. Call `POST /v1/tenants/agreements` separately.
- All historical instances are preserved — accepting a new version never overwrites the old accepted record. `GET /v1/tenants/agreements/history` returns the full history per type ordered newest first.
