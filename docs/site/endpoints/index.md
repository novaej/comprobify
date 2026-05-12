# Endpoints

Document endpoints require `Authorization: Bearer <api-key>` **and** `X-Issuer-Id: <issuer-id>`. Tenant settings, issuer management, and key management require only `Authorization: Bearer <api-key>`. Admin endpoints require `Authorization: Bearer <admin-secret>`. Registration and email verification are public.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

## Registration (public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/register` | Self-service: create tenant + issuer + sandbox API key. Idempotent — if the email already exists, revokes the current sandbox key and returns a new one (200). |
| `GET` | `/api/verify-email` | Verify email with token from registration email |
| `POST` | `/api/resend-verification` | Resend verification email (regenerates token) |

## Tenants (authenticated)

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/tenants/language` | Update the preferred language for outgoing emails |

## Issuers (authenticated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/issuers` | List all active issuers (branches / issue points) for the tenant |
| `POST` | `/api/issuers` | Create a new branch or issue point — inherits cert from an existing issuer of the tenant. Does NOT mint a new API key. |
| `GET` | `/api/issuers/:id` | Get a single issuer's profile (name, RUC, sandbox flag, cert expiry) |
| `POST` | `/api/issuers/:id/promote` | Promote the issuer to production — mints a production API key if the tenant does not already have one |
| `GET` | `/api/issuers/:id/document-types` | List active document types for the issuer |
| `POST` | `/api/issuers/:id/document-types` | Enable a document type for the issuer |
| `DELETE` | `/api/issuers/:id/document-types/:code` | Disable a document type for the issuer |

## API keys (authenticated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/keys` | List all active keys for the tenant (label, environment, created_at) |
| `POST` | `/api/keys` | Mint a new named key (`label`, optional `environment`) |
| `DELETE` | `/api/keys/:id` | Revoke an API key. Cannot revoke the key used for the current request. |

## Documents

Every document endpoint requires both `Authorization: Bearer <key>` and `X-Issuer-Id: <issuer-id>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/documents` | List documents with filtering and pagination |
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
| `POST` | `/api/admin/tenants` | Create tenant (manual onboarding, status ACTIVE) |
| `GET` | `/api/admin/tenants` | List all tenants |
| `PATCH` | `/api/admin/tenants/:id/tier` | Update tenant subscription tier |
| `PATCH` | `/api/admin/tenants/:id/status` | Activate or suspend a tenant |
| `POST` | `/api/admin/tenants/:id/verify` | Manually verify a tenant's email |
| `POST` | `/api/admin/tenants/:id/api-keys` | Mint a tenant-scoped API key (admin) |
| `POST` | `/api/admin/issuers` | Create issuer for a tenant (requires `tenantId`). Does NOT return an API key — mint one via `/api/admin/tenants/:id/api-keys`. |
| `GET` | `/api/admin/issuers` | List all issuers |
| `POST` | `/api/admin/issuers/:id/promote` | Promote any issuer to production (admin override) |
| `DELETE` | `/api/admin/api-keys/:id` | Revoke an API key |

## Monitoring

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | DB connectivity check for liveness probes |
