# Comprobify API

REST API for generating, digitally signing, and submitting electronic invoices (*facturas electrónicas*) to Ecuador's SRI (Servicio de Rentas Internas).

## What it does

Comprobify handles the full electronic document lifecycle on your behalf:

| Step | What happens |
|---|---|
| **Create** | Validates your invoice data, builds the SRI XML, signs it with XAdES-BES, and stores the signed document |
| **Send** | Submits the signed XML to the SRI SOAP service |
| **Authorize** | Queries the SRI for the authorization result; on success fires an email to the buyer with the RIDE PDF and XML attached |
| **Rebuild** | Corrects and re-signs a rejected document without changing its access key or sequential number |

## Event delivery

Register an HTTPS callback URL to receive events in near-real time — document authorizations, certificate expiry alerts, and more. The API signs every outgoing request with HMAC-SHA256 so your server can verify authenticity.

```
POST /api/webhooks    ← register your URL
```

If you cannot expose a public endpoint, poll `GET /api/notifications?sinceId=<id>` as a fallback. See [Webhooks](endpoints/webhooks.md) and [Notifications](endpoints/notifications.md) for details.

## Base URL

All endpoints are prefixed with `/api`.

```
https://your-deployment.com/api
```

## Authentication

API keys are tenant-scoped — one key can address every branch on your account. Document endpoints require both the Bearer key and an `X-Issuer-Id` header naming the target branch:

```
Authorization: Bearer <api-key>
X-Issuer-Id: <issuer-id>
```

Issuer-management and key-management endpoints need only the Bearer key. Admin endpoints use a separate secret:

```
Authorization: Bearer <admin-secret>
```

See [Getting Started](getting-started.md) for details on the key model, multiple branches, and minting named keys per integration.

## Response format

Successful responses return `200` or `201` with a JSON body. Error responses follow [RFC 7807 Problem Details](errors/index.md) — every error has a stable `code` field you can use for localization.
