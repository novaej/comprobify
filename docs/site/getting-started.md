# Getting Started

## Postman collection

Import the full collection to test every endpoint directly from Postman — all requests are pre-configured with variables for your base URL, API key, and access key.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **First time setup:** after importing, open the collection, go to **Variables**, and set `base_url`, `api_key`, and `admin_secret`. After creating an invoice, copy the returned `accessKey` into the `access_key` variable.

You can also download the collection JSON directly: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Register

Create your account, issuer, and sandbox API key in a single call:

```http
POST /api/register
Content-Type: multipart/form-data

email             your@email.com
ruc               1712345678001
businessName      My Company S.A.
branchCode        001
issuePointCode    001
environment       1
emissionType      1
requiredAccounting false
cert              <your .p12 file>
certPassword      <p12 password>
```

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

The account starts on the **FREE** tier (100 invoices/month, 1 issuer). All requests go to the SRI test environment until you promote to production.

---

## 2. Verify your email

A verification email is sent to the address you registered with. Click the link, or call the endpoint directly:

```http
GET /api/verify-email?token=<token>
```

Email verification is required before you can promote to production. You can issue sandbox invoices immediately without verifying.

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

---

## 6. Check authorization

```http
GET /api/documents/:accessKey/authorize
```

Queries the SRI for the authorization result. On success the document moves to `AUTHORIZED` and an email with the RIDE PDF is sent to the buyer.

---

## Going to production

Once you've verified your email and tested your integration in sandbox:

```http
POST /api/issuers/promote
Authorization: Bearer <your-sandbox-api-key>
```

This is **one-way** — there is no going back to sandbox. On success:
- Your sandbox key is revoked
- A new **production API key** is returned in the response
- Documents will be sent to the SRI production endpoint with `ambiente = 2`

```json
{
  "ok": true,
  "issuer": { "sandbox": false, ... },
  "apiKey": "<your-new-production-api-key>"
}
```

---

## Subscription tiers

| Tier | Price | Invoices/month | Issuers | Write limit |
|---|---|---|---|---|
| Free | $0 | 100 | 1 | 10 req/min |
| Starter | $29 | 1,000 | 2 | 60 req/min |
| Growth | $79 | 5,000 | 5 | 120 req/min |
| Business | $199 | 20,000 | unlimited | 300 req/min |

When you reach your monthly invoice quota the API returns `402 QUOTA_EXCEEDED`. Contact support to upgrade.

---

## Idempotency

`POST /api/documents` accepts an optional `Idempotency-Key` header. If you retry the same request after a timeout, send the same key — the API returns the existing document instead of creating a duplicate. Use a unique key per intended invoice (e.g. a UUID), and keep it consistent across retries.

---

## Rate Limiting

Requests are rate-limited per API key based on your subscription tier. When you exceed the limit, the API returns [`429 Too Many Requests`](errors/too-many-requests.md). Implement exponential backoff: wait 1s, then 2s, then 4s before retrying.

---

## Document statuses

| Status | Meaning |
|---|---|
| `SIGNED` | Created and signed, not yet sent to SRI |
| `RECEIVED` | Accepted by SRI for processing |
| `RETURNED` | SRI rejected the document — rebuild and resend |
| `AUTHORIZED` | SRI authorized the document — legally valid |
| `NOT_AUTHORIZED` | SRI processed but did not authorize — rebuild and resend |
