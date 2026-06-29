# Endpoints

Document endpoints require `Authorization: Bearer <api-key>` **and** `X-Issuer-Id: <issuer-id>`. Tenant settings, issuer management, and key management require only `Authorization: Bearer <api-key>`. Registration and email verification are public.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

## Registration (public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/register` | Self-service: create tenant + issuer + sandbox API key. Idempotent — if the email already exists, revokes the current sandbox key and returns a new one (200). |
| `GET` | `/v1/verify-email` | Verify email with token from registration email |
| `POST` | `/v1/resend-verification` | Resend verification email (regenerates token) |

## Tiers (public)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/tiers` | Full subscription tier catalog — quota, monthly/yearly price, overage rate, document types, limits |

## Payments (authenticated)

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/v1/payments/:id/proof` | Upload proof of an SPI bank transfer for a pending subscription payment |

## Tenants (authenticated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/tenants/me` | Resolve the tenant (id, email, tier, status, quota, environment) for the authenticated API key |
| `PATCH` | `/v1/tenants/language` | Update the preferred language for outgoing emails |
| `POST` | `/v1/tenants/promote` | Promote the tenant to production — revokes all sandbox keys and creates matching production keys |

## Issuers (authenticated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/issuers` | List all active issuers (branches / issue points) for the tenant |
| `POST` | `/v1/issuers` | Create a new branch or issue point — inherits cert from an existing issuer of the tenant. Does NOT mint a new API key. |
| `GET` | `/v1/issuers/:id` | Get a single issuer's profile (name, RUC, cert expiry) |
| `PATCH` | `/v1/issuers/:id` | Edit `tradeName` and/or `branchAddress` |
| `DELETE` | `/v1/issuers/:id` | Soft-delete an issuer (blocked if it's the last one or has issued documents) |
| `PATCH` | `/v1/issuers/:id/activate` | Reactivate a soft-deleted issuer (re-checks plan branch/issue-point limits) |
| `PATCH` | `/v1/issuers/:id/logo` | Upload or replace the issuer logo shown in RIDE PDFs (PNG/JPEG/GIF, max 500 KB) |
| `PATCH` | `/v1/issuers/:id/certificate` | Renew the issuer's P12 certificate (private key + cert) — e.g. when it has expired |
| `GET` | `/v1/issuers/:id/document-types` | List active document types for the issuer |
| `POST` | `/v1/issuers/:id/document-types` | Enable a document type for the issuer |
| `DELETE` | `/v1/issuers/:id/document-types/:code` | Disable a document type for the issuer |
| `GET` | `/v1/issuers/:id/sequentials` | View current and next sequential numbers per document type, by environment |
| `PATCH` | `/v1/issuers/:id/sequentials/:documentType` | Manually set the next sequential number for one document type/environment |

## API keys (authenticated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/keys` | List all active keys for the tenant (label, environment, created_at) |
| `POST` | `/v1/keys` | Mint a new named key (`label`, optional `environment`) |
| `DELETE` | `/v1/keys/:id` | Revoke an API key. Cannot revoke the key used for the current request. |

## Documents

Every document endpoint requires both `Authorization: Bearer <key>` and `X-Issuer-Id: <issuer-id>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/documents` | List documents with filtering and pagination |
| `GET` | `/v1/documents/stats` | Per-type document stats for the current month + needs-attention count |
| `POST` | `/v1/documents` | Create and sign a document — invoice ([Create Invoice](create-invoice.md)) or credit note ([Create Credit Note](create-credit-note.md)), selected by `documentType` |
| `GET` | `/v1/documents/:accessKey` | Get a document by access key |
| `POST` | `/v1/documents/:accessKey/send` | Submit signed document to SRI |
| `GET` | `/v1/documents/:accessKey/authorize` | Check SRI authorization status |
| `POST` | `/v1/documents/:accessKey/rebuild` | Rebuild and re-sign a rejected document |
| `GET` | `/v1/documents/:accessKey/ride` | Download RIDE PDF |
| `GET` | `/v1/documents/:accessKey/xml` | Download signed XML |
| `GET` | `/v1/documents/:accessKey/events` | Get audit event history |
| `GET` | `/v1/documents/:accessKey/credit-notes` | Sum of `AUTHORIZED` credit notes issued against this document + remaining balance |
| `POST` | `/v1/documents/email-retry` | Retry all failed/pending emails (batch) |
| `POST` | `/v1/documents/:accessKey/email-retry` | Retry email for a single document |

## Notifications (authenticated)

Tenant-level alerts for document events and certificate status. Supply `X-Issuer-Id` to filter to a specific issuer; omit to receive notifications across all your issuers. Use `?sinceId=<id>` to efficiently poll only new notifications since your last request.

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/notifications` | List active notifications (read and unread). Optional `?sinceId=<id>` for catch-up polling. |
| `POST` | `/v1/notifications/:id/read` | Mark a notification as read |
| `GET` | `/v1/notifications/preferences` | Get notification type preferences for the tenant |
| `PATCH` | `/v1/notifications/preferences` | Enable or disable notification types |

## Webhooks (authenticated)

Register HTTPS callback URLs to receive event notifications in near-real time.

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/webhooks` | Register a new webhook endpoint (secret shown once) |
| `GET` | `/v1/webhooks` | List active webhook endpoints (secrets excluded) |
| `PATCH` | `/v1/webhooks/:id` | Update URL, event subscriptions, or active flag |
| `DELETE` | `/v1/webhooks/:id` | Deregister an endpoint (soft-delete) |

## Monitoring

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | DB connectivity check for liveness probes |
