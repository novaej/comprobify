# Error Format

All error responses use [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807) with `Content-Type: application/problem+json`.

## Response shape

```json
{
  "type":     "https://docs.comprobify.com/errors/validation-error",
  "title":    "Validation Failed",
  "status":   400,
  "code":     "VALIDATION_FAILED",
  "detail":   "Validation failed",
  "instance": "/v1/documents"
}
```

| Field | Description |
|---|---|
| `type` | URL linking to the documentation page for this error type (this site) |
| `title` | Short, stable description of the error type |
| `status` | HTTP status code (same as the response status) |
| `code` | Stable machine-readable key — use this for i18n and programmatic handling |
| `detail` | Human-readable explanation of this specific occurrence |
| `instance` | The request path that produced the error |

## Using `code` for programmatic handling

The `code` field is the stable key your client application should switch on. It never changes for a given situation, regardless of changes to the human-readable `detail` text.

```js
switch (error.code) {
  case 'CERTIFICATE_EXPIRED':
    return 'Your signing certificate has expired. Replace it in issuer settings.';
  case 'RESEND_COOLDOWN':
    return 'Please wait before requesting another email.';
  case 'QUOTA_EXCEEDED':
    return 'Monthly invoice limit reached. Upgrade your plan.';
  default:
    return error.detail;
}
```

## Validation errors

When `code` is `VALIDATION_FAILED`, an additional `errors` array lists each field that failed:

```json
{
  "type":   "https://docs.comprobify.com/errors/validation-error",
  "title":  "Validation Failed",
  "status": 400,
  "code":   "VALIDATION_FAILED",
  "detail": "Validation failed",
  "instance": "/v1/documents",
  "errors": [
    {
      "field":   "buyer.email",
      "message": "Buyer email is required and must be a valid email address",
      "code":    "buyer.email",
      "value":   ""
    }
  ]
}
```

Each entry in `errors` has:

| Field | Description |
|---|---|
| `field` | The request body path that failed (e.g. `buyer.email`, `items[0].taxes[0].code`) |
| `message` | English description of the failure |
| `code` | Field path with array indices stripped — stable key for field-level localization (e.g. `items.taxes.code`) |
| `value` | The value that was submitted |

## SRI errors

`POST /:accessKey/send` and `GET /:accessKey/authorize` are asynchronous (see [Send to SRI](/endpoints/send-to-sri)) — `SRI_SUBMISSION_FAILED` can no longer be returned as an HTTP response from either endpoint. A network failure now happens inside the background worker and is recorded as an `ERROR` document event instead; see [SRI Submission Failed](/errors/sri-error) for details. The shape below is kept for reference:

When `code` is `SRI_SUBMISSION_FAILED`, an additional `sriMessages` array contains the raw messages returned by the SRI SOAP service:

```json
{
  "type":   "https://docs.comprobify.com/errors/sri-error",
  "title":  "SRI Submission Failed",
  "status": 502,
  "code":   "SRI_SUBMISSION_FAILED",
  "detail": "SRI rejected the document",
  "instance": "/v1/documents/1503.../send",
  "sriMessages": [
    {
      "identifier": "35",
      "message":    "ARCHIVO NO CUMPLE ESTRUCTURA XML",
      "type":       "ERROR"
    }
  ]
}
```

## All error codes

Most errors carry a specific `code` that is more precise than the HTTP status alone. Switch on `code`, not on `status`, to handle errors programmatically.

### 400 Bad Request

| Code | When |
|---|---|
| `VALIDATION_FAILED` | One or more request fields failed validation — see `errors[]` |
| `CERTIFICATE_INVALID` | P12 file is corrupted or not a valid PKCS#12 archive |
| `CERTIFICATE_PASSWORD_INVALID` | P12 password is incorrect |
| `CERTIFICATE_KEY_NOT_FOUND` | Signing key bag not found inside the P12 |
| `CERTIFICATE_EXPIRED` | Certificate `notAfter` date has passed |
| `ISSUER_ID_REQUIRED` | `X-Issuer-Id` header is missing on a document endpoint |
| `ISSUER_ID_INVALID` | `X-Issuer-Id` is not a valid positive integer |
| `INVALID_OR_EXPIRED_TOKEN` | Email verification token is invalid or has expired |
| `DOCUMENT_TYPE_NOT_ENABLED` | Requested document type is not active for this issuer |
| `DOCUMENT_TYPE_NOT_SUPPORTED` | Document type code is not registered in the system |
| `INVALID_STATE_TRANSITION` | Document operation is not valid for its current status |
| `DOCUMENT_NOT_AUTHORIZED` | Operation (RIDE, email) requires document status `AUTHORIZED` |
| `SELF_REVOCATION_FORBIDDEN` | Cannot revoke the API key used to authenticate this request |
| `INVALID_FILE_UPLOAD` | Uploaded file is missing, the wrong type, or exceeds the field's size limit (e.g. a logo over 500 KB) |
| `PROOF_FILE_LIMIT_REACHED` | Payment already has the maximum number of active proof files (10) — delete one before uploading more |
| `VERSION_MISMATCH` | `termsVersion` in `POST /v1/register` or `POST /v1/tenants/agreements` does not match the currently published TERMS document version — re-fetch `GET /v1/agreements` and present the current version before asking the user to accept again |
| `LAST_ISSUER_CANNOT_BE_REMOVED` | Tenant has only one active issuer left — it cannot be removed |
| `ISSUER_HAS_DOCUMENTS` | Issuer has issued documents (in either environment) and cannot be removed |
| `SEQUENTIAL_CANNOT_DECREASE` | `nextSequential` is not greater than the counter's current value |
| `TIER_CHANGE_NO_OP` | Requested tier and billing interval on Change Tier both match the subscription's current values |
| `INVALID_BILLING_INTERVAL` | `billingInterval` on Create Subscription or Change Tier is not `MONTHLY` or `YEARLY` |
| `BAD_REQUEST` | Other malformed request (fallback — read `detail`) |

### 401 Unauthorized

| Code | When |
|---|---|
| `API_KEY_ENV_MISMATCH` | API key environment (`sandbox`/`production`) does not match the tenant's current environment |
| `UNAUTHORIZED` | Missing, invalid, or revoked API key (fallback) |

### 402 Payment Required

| Code | When |
|---|---|
| `QUOTA_EXCEEDED` | Monthly document quota reached — upgrade plan |
| `BRANCH_LIMIT_REACHED` | Tenant has reached the maximum number of branches for their plan |
| `ISSUE_POINT_LIMIT_REACHED` | Branch has reached the maximum number of issue points for this plan |
| `WEBHOOK_ENDPOINT_LIMIT_REACHED` | Tenant has reached the maximum number of webhook endpoints for their plan |
| `DOCUMENT_TYPE_NOT_IN_TIER` | Document type isn't included in the tenant's current plan — upgrade to enable it |

### 403 Forbidden

| Code | When |
|---|---|
| `ISSUER_FORBIDDEN` | `X-Issuer-Id` names an issuer that belongs to a different tenant |
| `ACCOUNT_SUSPENDED` | Tenant account is suspended — contact support |
| `EMAIL_VERIFICATION_REQUIRED` | Operation requires a verified email address |
| `AGREEMENT_ACCEPTANCE_REQUIRED` | Promotion blocked — one or more agreements are still `PENDING` (check `GET /v1/tenants/agreements`, view at `GET /v1/tenants/agreements/:type`, accept via `POST /v1/tenants/agreements`) |
| `PRODUCTION_KEY_REQUIRES_PROMOTION` | Production API key cannot be created before promoting to production |
| `FORBIDDEN` | Other permission failure (fallback — read `detail`) |

### 404 Not Found

| Code | When |
|---|---|
| `ISSUER_NOT_FOUND` | Issuer ID in `X-Issuer-Id` or URL parameter does not exist |
| `SOURCE_ISSUER_NOT_FOUND` | `sourceIssuerId` not found or belongs to a different tenant |
| `WEBHOOK_ENDPOINT_NOT_FOUND` | Webhook endpoint not found or belongs to a different tenant |
| `SUBSCRIPTION_NOT_FOUND` | Subscription not found |
| `PAYMENT_NOT_FOUND` | Payment not found, or belongs to a different tenant |
| `AGREEMENT_NOT_FOUND` | No document of the requested type (TERMS, PRIVACY, or DPA) has been published yet |
| `NOT_FOUND` | Other resource not found (document, API key — read `detail`) |

### 409 Conflict

| Code | When |
|---|---|
| `ALREADY_VERIFIED` | Attempting to resend verification to an already-verified account |
| `SUBSCRIPTION_ALREADY_IN_FLIGHT` | Tenant already has a subscription in progress (promotion with `tier`, or Admin's Create Subscription) |
| `NO_ACTIVE_SUBSCRIPTION` | Cancel or Change Tier requested but the tenant has no `ACTIVE` subscription |
| `TIER_CHANGE_ALREADY_PENDING` | A tier/billing-interval change is already scheduled, or its payment is already in flight, for this subscription |
| `CANCELLATION_ALREADY_PENDING` | A cancellation (`DELETE /v1/subscriptions`) is already scheduled for this subscription |
| `CONFLICT` | Idempotency key reused with a different payload, payment already decided, or other conflict |

### 429 Too Many Requests

| Code | When |
|---|---|
| `RESEND_COOLDOWN` | Resend verification requested again before the 60-second cooldown elapsed |
| `TOO_MANY_REQUESTS` | API key rate limit exceeded |

### 500 / 502

| Code | When |
|---|---|
| `SRI_SUBMISSION_FAILED` | SRI SOAP service returned an error or unexpected HTTP status — no longer surfaced via any HTTP response (see [SRI errors](#sri-errors) above); now recorded as a document `ERROR` event |
| `INTERNAL_ERROR` | Unexpected server error |
