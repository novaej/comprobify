# Getting Started

## Postman collection

Import the full collection to test every endpoint directly from Postman — all requests are pre-configured with variables for your base URL, API key, and access key.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **First time setup:** after importing, open the collection, go to **Variables**, and set `base_url` and `api_key`. After creating an invoice, copy the returned `accessKey` into the `access_key` variable.

You can also download the collection JSON directly: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Register

Create your account, issuer, and sandbox API key in a single call. Each RUC can only be registered once.

```http
POST /v1/register
Content-Type: multipart/form-data
```

| Field | Description |
|---|---|
| `email` | Your email address — used for verification and billing |
| `ruc` | Your 13-digit Ecuadorian tax ID (RUC) |
| `businessName` | Legal company name as it appears on your RUC |
| `branchCode` | 3-digit SRI branch code (e.g. `001` for the main branch) |
| `issuePointCode` | 3-digit SRI issue point code (e.g. `001`) |
| `environment` | (Deprecated — ignored) Historically controlled SRI environment. All new accounts start in sandbox; use `POST /v1/tenants/promote` to move to production. |
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
GET /v1/verify-email?token=<token>
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

**One API key covers your entire account (all branches).** API keys are **tenant-scoped**, not issuer-scoped. One key can address any of your branches; you declare the target branch via the `X-Issuer-Id` header on each request.

Your account (tenant) can have multiple issuers — each one is a unique pair of `branchCode` and `issuePointCode` (e.g., `001/001`, `001/002`, `002/001`). When you call `POST /v1/documents`, the API uses the key to identify your tenant, then uses `X-Issuer-Id` to determine:
- Which branch and issue point to embed in the document
- Which digital certificate to sign with
- Which sequential number sequence to draw from

### Listing your issuers

```http
GET /v1/issuers
Authorization: Bearer <your-api-key>
```

Returns every issuer (branch / issue point) under your tenant with its numeric `id`. Use that `id` as the `X-Issuer-Id` header value on document requests.

### Adding a new branch or issue point

Once your email is verified, call `POST /v1/issuers` with your API key:

```http
POST /v1/issuers
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

Since one tenant-scoped key covers all your branches, you can mint additional keys via `POST /v1/keys` to track which integration is making each call (frontend, ERP, mobile app, etc.):

```http
POST /v1/keys
Authorization: Bearer <your-api-key>
Content-Type: application/json

{ "label": "ERP integration", "environment": "sandbox" }
```

Use `GET /v1/keys` to list them and `DELETE /v1/keys/:id` to revoke one. `environment` defaults to `sandbox`; minting a `production` key requires that the tenant has been promoted. All keys under the same tenant can address the same set of branches — the difference is observability (which integration made the call) and granular revocation (revoke a compromised integration without affecting others).

### Key lifecycle

| Stage | Key environment | What to do |
|---|---|---|
| After registration | Sandbox | Use for testing against the SRI test environment. |
| After `POST /v1/tenants/promote` | Production | All sandbox keys are revoked and production mirrors are returned in the response. |
| Adding integrations | Same tenant | Mint named keys via `POST /v1/keys` for per-integration observability. |
| Lost key | — | Mint a replacement via `POST /v1/keys`, revoke the old one via `DELETE /v1/keys/:id`. |

### Why tenant-scoped keys?

One key covers your whole account, so a frontend or ERP that operates on multiple branches doesn't have to juggle separate credentials. Per-integration accountability comes from named keys (`frontend-prod`, `erp`, `mobile`) rather than per-branch keys. Revoking a leaked key only affects the integration that used it; other keys keep working.

---

## 4. Register a webhook endpoint (recommended)

Register an HTTPS URL on your server to receive event notifications in near-real time — document authorizations, certificate alerts, and any future event types the API produces.

```http
POST /v1/webhooks
Authorization: Bearer <your-api-key>
Content-Type: application/json

{
  "url": "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING", "CERT_EXPIRED"]
}
```

Response:

```json
{
  "ok": true,
  "endpoint": {
    "id": 1,
    "url": "https://app.example.com/v1/comprobify/events",
    "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING", "CERT_EXPIRED"],
    "active": true
  },
  "secret": "a3f5c8d1e2b4..."
}
```

**Store the `secret` immediately — it is shown only once.** Use it to verify the `X-Comprobify-Signature` header on every incoming request.

Omit `eventTypes` (or pass `[]`) to subscribe to all event types. You can register up to the limit for your plan (FREE: 1, STARTER: 2, GROWTH: 5, BUSINESS: 10) and manage them via `GET / PATCH / DELETE /v1/webhooks`.

> **If you cannot expose a public HTTPS URL** (local development, behind a firewall), poll `GET /v1/notifications?sinceId=<lastId>` instead. Store the highest `id` seen from each poll and pass it on the next request to efficiently catch up — see [Notifications](endpoints/notifications.md).

---

## 5. Create an invoice

```http
POST /v1/documents
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

## 6. Send to SRI

```http
POST /v1/documents/:accessKey/send
```

Submits the signed XML to the SRI. The document moves to `RECEIVED` or `RETURNED`.

- **`RECEIVED`** — SRI accepted the document for processing. Proceed to step 7.
- **`RETURNED`** — SRI rejected the document (invalid data, schema error, etc.). Fix the issue and [rebuild](endpoints/rebuild-invoice.md) before resending.

---

## 7. Check authorization

```http
GET /v1/documents/:accessKey/authorize
```

Queries the SRI for the authorization result.

- **`AUTHORIZED`** — the invoice is legally valid. An email with the RIDE PDF and XML is sent to the buyer automatically.
- **`NOT_AUTHORIZED`** — SRI processed the document but did not authorize it. [Rebuild](endpoints/rebuild-invoice.md) with corrected data and resend.

---

## Going to production

Once you have verified your email and tested your integration in sandbox:

```http
POST /v1/tenants/promote
Authorization: Bearer <your-api-key>
Content-Type: application/json

{}
```

An empty body is valid. Optionally supply `initialSequentials` to set starting sequential numbers per issuer × document type.

This is **one-way** — there is no going back to sandbox. On success:
- **All active sandbox API keys are revoked** and a production key is created for each one, preserving the same label
- All new production tokens are returned in the response — **store them immediately, they are shown only once**
- All branches are promoted at once — there is no per-branch promotion
- All subsequent documents for any branch will be sent to the SRI production endpoint with `ambiente = 2`

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial sandbox key", "apiKey": "<production-token>" },
    { "label": "ERP integration",     "apiKey": "<production-token>" }
  ]
}
```

Distribute each token to the integration that previously used the sandbox key with the same label.

> If your account status is `PENDING_VERIFICATION` (email not yet verified), this call returns `403`. Verify your email first.

---

## Subscription tiers

| Tier | Document quota | Max branches | Max issue points per branch | Max webhook endpoints | Write limit |
|---|---|---|---|---|---|
| Free | 100 | 1 | 1 | 1 | 10 req/min |
| Starter | 1,000 | 3 | 2 | 2 | 60 req/min |
| Growth | 5,000 | 10 | 5 | 5 | 120 req/min |
| Business | 20,000 | Unlimited | Unlimited | 10 | 300 req/min |

The document quota is shared across all branches and document types. When you reach it, `POST /v1/documents` returns `402 QUOTA_EXCEEDED`. Contact support to upgrade your plan.

Attempting to create a branch beyond the tier limit returns `402 PAYMENT_REQUIRED`.

---

## Idempotency

`POST /v1/documents` accepts an optional `Idempotency-Key` header. If you retry the same request after a timeout, send the same key — the API returns the existing document instead of creating a duplicate. Use a unique key per intended invoice (e.g. a UUID), and keep it consistent across retries.

---

## Rate Limiting

Requests are rate-limited per API key based on your subscription tier (see table above). When you exceed the limit, the API returns [`429 Too Many Requests`](errors/too-many-requests.md). Implement exponential backoff: wait 1s, then 2s, then 4s before retrying.

`POST /v1/register` is additionally limited to **5 requests per hour per IP address**, regardless of tier.

---

## Document statuses

| Status | Meaning | Next step |
|---|---|---|
| `SIGNED` | Created and signed, not yet sent to SRI | Send to SRI |
| `RECEIVED` | Accepted by SRI for processing | Check authorization |
| `RETURNED` | SRI rejected the document | Rebuild and resend |
| `AUTHORIZED` | SRI authorized — legally valid | Done |
| `NOT_AUTHORIZED` | SRI did not authorize | Rebuild and resend |
