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

## Base URL

All endpoints are prefixed with `/api`.

```
https://your-deployment.com/api
```

## Authentication

All document endpoints require a Bearer API key issued by the admin:

```
Authorization: Bearer <api-key>
```

Admin endpoints use a separate secret:

```
Authorization: Bearer <admin-secret>
```

See [Getting Started](getting-started.md) for details.

## Response format

Successful responses return `200` or `201` with a JSON body. Error responses follow [RFC 7807 Problem Details](errors/index.md) — every error has a stable `code` field you can use for localization.
