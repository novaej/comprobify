# Endpoints

Document endpoints require `Authorization: Bearer <api-key>`. Admin endpoints require `Authorization: Bearer <admin-secret>`. Registration and email verification are public.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

## Registration (public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/register` | Self-service: create tenant + issuer + sandbox API key |
| `GET` | `/api/verify-email` | Verify email with token from registration email |
| `POST` | `/api/resend-verification` | Resend verification email (regenerates token) |

## Issuers (authenticated)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/issuers/promote` | Promote issuer to production — returns new production API key |

## Documents

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
| `POST` | `/api/admin/issuers` | Create issuer for a tenant (requires `tenantId`) |
| `GET` | `/api/admin/issuers` | List all issuers |
| `POST` | `/api/admin/issuers/:id/promote` | Promote any issuer to production (admin override) |
| `POST` | `/api/admin/issuers/:id/api-keys` | Create API key for an issuer |
| `DELETE` | `/api/admin/api-keys/:id` | Revoke an API key |

## Monitoring

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | DB connectivity check for liveness probes |
