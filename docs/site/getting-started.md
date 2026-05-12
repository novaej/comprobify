# Getting Started

## Postman collection

Import the full collection to test every endpoint directly from Postman — all requests are pre-configured with variables for your base URL, API key, and access key.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **First time setup:** after importing, open the collection, go to **Variables**, and set `base_url`, `api_key`, and `admin_secret`. After creating an invoice, copy the returned `accessKey` into the `access_key` variable.

You can also download the collection JSON directly: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Register

Create your account, issuer, and sandbox API key in a single call. Each RUC can only be registered once.

```http
POST /api/register
Content-Type: multipart/form-data
```

| Field | Description |
|---|---|
| `email` | Your email address — used for verification and billing |
| `ruc` | Your 13-digit Ecuadorian tax ID (RUC) |
| `businessName` | Legal company name as it appears on your RUC |
| `branchCode` | 3-digit SRI branch code (e.g. `001` for the main branch) |
| `issuePointCode` | 3-digit SRI issue point code (e.g. `001`) |
| `environment` | SRI XML environment value: `1` for test, `2` for production. Use `1` — all new accounts start in sandbox regardless of this value |
| `emissionType` | SRI emission type: always `1` (normal) |
| `requiredAccounting` | `true` if your company is required to keep accounting records (*obligado a llevar contabilidad*), `false` otherwise |
| `cert` | Your `.p12` digital certificate file issued by the SRI CA (Banco Central or Security Data) |
| `certPassword` | Password for the `.p12` file |

Response:

```json
{
  "ok": true,
  "tenant": {
    "id": 1,
    "email": "your@email.com",
    "subscriptionTier": "FREE",
    "status": "PENDING_VERIFICATION",
    "documentQuota": 100
  },
  "issuer": { "id": 1, "ruc": "...", "sandbox": true },
  "apiKey": "<your-sandbox-api-key>"
}
```

**Store the `apiKey` — it is shown only once.**

The account starts on the **FREE** tier (100 documents, 1 branch, 1 issuing point). All documents are sent to the SRI test environment until you promote to production.

**Registration errors:**

| Status | Code | Reason |
|---|---|---|
| `409` | `CONFLICT` | Email already registered |
| `409` | `CONFLICT` | RUC already registered |
| `400` | `BAD_REQUEST` | Certificate is expired or invalid |
| `429` | `TOO_MANY_REQUESTS` | More than 5 registration attempts per hour from this IP |

---

## 2. Verify your email

A verification email is sent to the address you registered with. Click the link, or call the endpoint directly with the token from the email:

```http
GET /api/verify-email?token=<token>
```

Email verification is required before you can promote to production. You can issue sandbox invoices immediately without verifying.

> If you are integrating programmatically and email is not available, contact support to verify your account manually.

---

## 3. Authenticate requests

Include your API key as a Bearer token on every document request:

```http
Authorization: Bearer <your-api-key>
```

The key is SHA-256 hashed on each request — the plaintext is never persisted after creation. If a key is compromised, contact support to revoke it and issue a new one.

---

## Understanding API keys and branches

This is the most important concept to understand before integrating.

**One API key = one issuer = one branch + issue point combination.**

Your account (tenant) can have multiple issuers — each one is a unique pair of `branchCode` and `issuePointCode` (e.g., `001/001`, `001/002`, `002/001`). API keys live at the **tenant** level: one key can address any of your branches. Each request declares its target branch via the `X-Issuer-Id` header.

When you call `POST /api/documents`, the API uses the key to identify your tenant, then uses `X-Issuer-Id` to determine:
- Which branch and issue point to embed in the document
- Which digital certificate to sign with
- Which sequential number sequence to draw from

### Listing your issuers

```http
GET /api/issuers
Authorization: Bearer <your-api-key>
```

Returns every issuer (branch / issue point) under your tenant with its numeric `id`. Use that `id` as the `X-Issuer-Id` header value on document requests.

### Adding a new branch or issue point

Once your email is verified, call `POST /api/issuers` with your API key:

```http
POST /api/issuers
Authorization: Bearer <your-api-key>
Content-Type: multipart/form-data

branchCode=002
issuePointCode=001
```

The new issuer inherits your RUC, business name, and digital certificate from your tenant's first existing issuer (or pass `sourceIssuerId` to pick a specific one):

```json
{
  "ok": true,
  "issuer": { "id": 2, "branchCode": "002", "issuePointCode": "001", "sandbox": true }
}
```

No new API key is minted — the key you already have covers every branch under your tenant.

### Multiple named keys per tenant

You can mint additional keys via `POST /api/keys` to track which integration is making each call:

```http
POST /api/keys
Authorization: Bearer <your-api-key>
Content-Type: application/json

{ "label": "ERP integration", "environment": "sandbox" }
```

Use `GET /api/keys` to list them and `DELETE /api/keys/:id` to revoke one. `environment` defaults to `sandbox`; minting a `production` key requires that at least one of your issuers has been promoted.

### Key lifecycle

| Stage | Key environment | What to do |
|---|---|---|
| After registration | Sandbox | Use for testing against the SRI test environment. |
| After `POST /api/issuers/:id/promote` | Production | The first promotion mints a production key. Sandbox keys remain valid for sandbox issuers. |
| Adding integrations | Same tenant | Mint named keys via `POST /api/keys` for per-integration observability. |
| Lost key | — | Mint a replacement via `POST /api/keys`, revoke the old one via `DELETE /api/keys/:id`. |

### Why tenant-scoped keys?

One key covers your whole account, so a frontend or ERP that operates on multiple branches doesn't have to juggle separate credentials. Per-integration accountability comes from named keys (`frontend-prod`, `erp`, `mobile`) rather than per-branch keys. Revoking a leaked key only affects the integration that used it; other keys keep working.

---

## 4. Create an invoice

```http
POST /api/documents
Authorization: Bearer <your-api-key>
X-Issuer-Id: <issuer-id>
Content-Type: application/json
Idempotency-Key: <unique-key>   (optional but recommended)

{
  "documentType": "01",
  "buyer": {
    "idType": "05",
    "id": "1234567890",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "items": [...],
  "payments": [...]
}
```

Every document endpoint (POST, GET, DELETE) requires the `X-Issuer-Id` header naming the target branch. Omit it → `400 ISSUER_ID_REQUIRED`. Pass an id belonging to another tenant → `403 ISSUER_FORBIDDEN`.

Returns the signed document with status `SIGNED`. See [Create Invoice](endpoints/create-invoice.md) for the full schema.

---

## 5. Send to SRI

```http
POST /api/documents/:accessKey/send
```

Submits the signed XML to the SRI. The document moves to `RECEIVED` or `RETURNED`.

- **`RECEIVED`** — SRI accepted the document for processing. Proceed to step 6.
- **`RETURNED`** — SRI rejected the document (invalid data, schema error, etc.). Fix the issue and [rebuild](endpoints/rebuild-invoice.md) before resending.

---

## 6. Check authorization

```http
GET /api/documents/:accessKey/authorize
```

Queries the SRI for the authorization result.

- **`AUTHORIZED`** — the invoice is legally valid. An email with the RIDE PDF and XML is sent to the buyer automatically.
- **`NOT_AUTHORIZED`** — SRI processed the document but did not authorize it. [Rebuild](endpoints/rebuild-invoice.md) with corrected data and resend.

---

## Going to production

Once you have verified your email and tested your integration in sandbox:

```http
POST /api/issuers/:id/promote
Authorization: Bearer <your-sandbox-api-key>
```

Replace `:id` with the numeric id of the issuer to promote (from `GET /api/issuers`).

This is **one-way** — there is no going back to sandbox. On success:
- A **production API key** is returned the first time you promote any of the tenant's issuers — store it immediately
- Subsequent promotions return `apiKey: null` because the tenant already has a production key
- Sandbox keys are **not** auto-revoked; they keep working for any remaining sandbox issuers. Revoke unused ones via `DELETE /api/keys/:id`
- All subsequent documents addressed to the promoted issuer (via `X-Issuer-Id`) will be sent to the SRI production endpoint with `ambiente = 2`

```json
{
  "ok": true,
  "issuer": { "sandbox": false, ... },
  "apiKey": "<your-new-production-api-key-or-null>"
}
```

> If your account status is `PENDING_VERIFICATION` (email not yet verified), this call returns `403`. Verify your email first.

---

## Subscription tiers

| Tier | Document quota | Max branches | Max issue points per branch | Write limit |
|---|---|---|---|---|
| Free | 100 | 1 | 1 | 10 req/min |
| Starter | 1,000 | 3 | 2 | 60 req/min |
| Growth | 5,000 | 10 | 5 | 120 req/min |
| Business | 20,000 | Unlimited | Unlimited | 300 req/min |

The document quota is shared across all branches and document types. When you reach it, `POST /api/documents` returns `402 QUOTA_EXCEEDED`. Contact support to upgrade your plan.

Attempting to create a branch beyond the tier limit returns `402 PAYMENT_REQUIRED`.

---

## Idempotency

`POST /api/documents` accepts an optional `Idempotency-Key` header. If you retry the same request after a timeout, send the same key — the API returns the existing document instead of creating a duplicate. Use a unique key per intended invoice (e.g. a UUID), and keep it consistent across retries.

---

## Rate Limiting

Requests are rate-limited per API key based on your subscription tier (see table above). When you exceed the limit, the API returns [`429 Too Many Requests`](errors/too-many-requests.md). Implement exponential backoff: wait 1s, then 2s, then 4s before retrying.

`POST /api/register` is additionally limited to **5 requests per hour per IP address**, regardless of tier.

---

## Document statuses

| Status | Meaning | Next step |
|---|---|---|
| `SIGNED` | Created and signed, not yet sent to SRI | Send to SRI |
| `RECEIVED` | Accepted by SRI for processing | Check authorization |
| `RETURNED` | SRI rejected the document | Rebuild and resend |
| `AUTHORIZED` | SRI authorized — legally valid | Done |
| `NOT_AUTHORIZED` | SRI did not authorize | Rebuild and resend |
