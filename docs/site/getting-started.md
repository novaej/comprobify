# Getting Started

## Postman collection

Import the full collection to test every endpoint directly from Postman — all requests are pre-configured with variables for your base URL, API key, and access key.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **First time setup:** after importing, open the collection, go to **Variables**, and set `base_url`, `api_key`, and `admin_secret`. After creating an invoice, copy the returned `accessKey` into the `access_key` variable.

You can also download the collection JSON directly: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

## 1. Obtain an API key

API keys are issued by the admin. Each key is scoped to one issuer (RUC + branch + issue point combination).

```http
POST /api/admin/issuers
Authorization: Bearer <admin-secret>
```

The response includes both the issuer record and an initial **sandbox** API key. Additional keys can be created later:

```http
POST /api/admin/issuers/:id/api-keys
Authorization: Bearer <admin-secret>
```

### Sandbox vs production keys

Every API key is stamped with the environment of its issuer at creation time (`sandbox` or `production`). A sandbox key will be rejected if used against a production issuer, and vice versa.

New issuers start in sandbox mode. To go live, promote the issuer to production:

```http
POST /api/admin/issuers/:id/promote
Authorization: Bearer <admin-secret>
```

**This is one-way — there is no going back to sandbox.** When promotion succeeds, all existing sandbox keys are revoked automatically. You must create a new key to begin sending production invoices:

```http
POST /api/admin/issuers/:id/api-keys
Authorization: Bearer <admin-secret>
```

## 2. Authenticate requests

Include your API key as a Bearer token on every document request:

```http
Authorization: Bearer <your-api-key>
```

The key is SHA-256 hashed on each request and compared against stored hashes — the plaintext key is never persisted after creation. If a key is compromised, revoke it with `DELETE /api/admin/api-keys/:id` and create a new one.

## 3. Create an invoice

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

## 4. Send to SRI

```http
POST /api/documents/:accessKey/send
```

Submits the signed XML to the SRI. The document moves to `RECEIVED` or `RETURNED`.

## 5. Check authorization

```http
GET /api/documents/:accessKey/authorize
```

Queries the SRI for the authorization result. On success the document moves to `AUTHORIZED` and an email with the RIDE PDF is sent to the buyer.

## Idempotency

`POST /api/documents` accepts an optional `Idempotency-Key` header. If you retry the same request after a timeout, send the same key — the API returns the existing document instead of creating a duplicate. Use a unique key per intended invoice (e.g. a UUID), and keep it consistent across retries for the same invoice.

## Rate Limiting

All API requests are rate-limited per API key to prevent abuse:

- **Write endpoints** (POST): 60 requests per minute
- **Read endpoints** (GET): 300 requests per minute

When you exceed the limit, the API returns [`429 Too Many Requests`](errors/too-many-requests.md). Implement exponential backoff and retry logic in your client.

**Best practices:**
- Batch operations when possible (e.g., avoid polling a single document repeatedly)
- Implement exponential backoff: wait 1s, then 2s, then 4s, etc. before retrying
- Cache read results to reduce GET request volume
- Contact support if you have sustained high-volume needs

## Document statuses

| Status | Meaning |
|---|---|
| `SIGNED` | Created and signed, not yet sent to SRI |
| `RECEIVED` | Accepted by SRI for processing |
| `RETURNED` | SRI rejected the document — rebuild and resend |
| `AUTHORIZED` | SRI authorized the document — legally valid |
| `NOT_AUTHORIZED` | SRI processed but did not authorize — rebuild and resend |
