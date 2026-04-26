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
    "invoiceQuota": 100
  },
  "issuer": { "id": 1, "ruc": "...", "sandbox": true },
  "apiKey": "<your-sandbox-api-key>"
}
```

**Store the `apiKey` — it is shown only once.**

The account starts on the **FREE** tier (100 invoices/month, 1 issuer). All documents are sent to the SRI test environment until you promote to production.

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

## 4. Create an invoice

```http
POST /api/documents
Authorization: Bearer <your-api-key>
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
POST /api/issuers/promote
Authorization: Bearer <your-sandbox-api-key>
```

This is **one-way** — there is no going back to sandbox. On success:
- Your sandbox key is revoked immediately
- A new **production API key** is returned in the response — store it, it is shown only once
- All subsequent documents will be sent to the SRI production endpoint with `ambiente = 2`

```json
{
  "ok": true,
  "issuer": { "sandbox": false, ... },
  "apiKey": "<your-new-production-api-key>"
}
```

> If your account status is `PENDING_VERIFICATION` (email not yet verified), this call returns `403`. Verify your email first.

---

## Subscription tiers

| Tier | Price | Invoices/month | Issuers | Write limit |
|---|---|---|---|---|
| Free | $0 | 100 | 1 | 10 req/min |
| Starter | $29 | 1,000 | 2 | 60 req/min |
| Growth | $79 | 5,000 | 5 | 120 req/min |
| Business | $199 | 20,000 | unlimited | 300 req/min |

When you reach your monthly invoice quota, `POST /api/documents` returns `402 QUOTA_EXCEEDED`. Contact support to upgrade your plan.

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
