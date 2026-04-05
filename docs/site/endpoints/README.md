# Endpoints

All document endpoints require `Authorization: Bearer <api-key>`. Admin endpoints require `Authorization: Bearer <admin-secret>`.

## Documents

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/documents` | Create and sign an invoice |
| `GET` | `/api/documents/:accessKey` | Get a document by access key |
| `POST` | `/api/documents/:accessKey/send` | Submit signed document to SRI |
| `GET` | `/api/documents/:accessKey/authorize` | Check SRI authorization status |
| `POST` | `/api/documents/:accessKey/rebuild` | Rebuild and re-sign a rejected document |
| `GET` | `/api/documents/:accessKey/ride` | Download RIDE PDF |
| `GET` | `/api/documents/:accessKey/xml` | Download signed XML |
| `GET` | `/api/documents/:accessKey/events` | Get audit event history |
| `POST` | `/api/documents/email-retry` | Retry all failed/pending emails (batch) |
| `POST` | `/api/documents/:accessKey/email-retry` | Retry email for a single document |

## Webhooks

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/mailgun/webhook` | Mailgun delivery event receiver |

## Admin

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/issuers` | Create issuer with P12 cert or branch copy |
| `GET` | `/api/admin/issuers` | List all issuers |
| `POST` | `/api/admin/issuers/:id/api-keys` | Create API key for an issuer |
| `DELETE` | `/api/admin/api-keys/:id` | Revoke an API key |
