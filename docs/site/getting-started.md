# Getting Started

## Postman collection

Import the full collection to test every endpoint directly from Postman — all requests are pre-configured with variables for your base URL, API key, and access key.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/comprobify)

> **First time setup:** after importing, open the collection, go to **Variables**, and set `base_url`, `api_key`, and `admin_secret`. After creating an invoice, copy the returned `accessKey` into the `access_key` variable.

You can also download the collection JSON directly: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

## 1. Obtain an API key

API keys are issued by the admin. Each key is scoped to one issuer (RUC + branch + issue point combination).

```http
POST /api/admin/issuers
Authorization: Bearer <admin-secret>
```

The response includes both the issuer record and an initial API key. Additional keys can be created later:

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

## Document statuses

| Status | Meaning |
|---|---|
| `SIGNED` | Created and signed, not yet sent to SRI |
| `RECEIVED` | Accepted by SRI for processing |
| `RETURNED` | SRI rejected the document — rebuild and resend |
| `AUTHORIZED` | SRI authorized the document — legally valid |
| `NOT_AUTHORIZED` | SRI processed but did not authorize — rebuild and resend |
