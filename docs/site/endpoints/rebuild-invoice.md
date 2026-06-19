# Rebuild Invoice

Corrects and re-signs a rejected document. The rebuilt document keeps the same `accessKey`, `sequential`, and `issueDate` as the original — only the invoice content is replaced.

```
POST /v1/documents/:accessKey/rebuild
```

Use this when a document is in `RETURNED` or `NOT_AUTHORIZED` status. After rebuilding, send it again with [Send to SRI](send-to-sri.md).

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (numeric id from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document to rebuild |

## Request body

```json
{
  "documentType": "01",
  "buyer": {
    "idType": "05",
    "id": "1234567890",
    "name": "John Doe",
    "email": "john@example.com",
    "address": "Av. Amazonas 123"
  },
  "items": [
    {
      "mainCode": "PROD-001",
      "auxiliaryCode": "AUX-001",
      "description": "Web development service",
      "quantity": "1.00",
      "unitPrice": "100.00",
      "discount": "0.00",
      "taxes": [
        {
          "code": "2",
          "rateCode": "2",
          "rate": "15.00",
          "taxableBase": "100.00",
          "taxAmount": "15.00"
        }
      ]
    }
  ],
  "payments": [
    {
      "method": "01",
      "total": "115.00",
      "term": 30,
      "termUnit": "dias"
    }
  ],
  "additionalInfo": [
    { "name": "Contract", "value": "CTR-2026-001" }
  ]
}
```

### What is preserved from the original document

The following fields are **always taken from the original document** and cannot be changed via rebuild:

| Field | Reason |
|---|---|
| `accessKey` | SRI ties all subsequent status checks to this key |
| `sequential` | Sequential numbers are assigned once and not recycled |
| `issueDate` | SRI validates the date embedded in the access key |
| `documentType` | Cannot change the type of an existing document |

The `documentType` field is still required by validation, but must match the original document's type — the value supplied in the body is ignored at the service level.

### What can be corrected

All invoice content fields are replaced atomically:

| Field | Type | Required | Description |
|---|---|---|---|
| `documentType` | string | Yes | Must match the original document type (e.g. `"01"`) |
| `buyer.idType` | string | Yes | 2-digit SRI identification type code |
| `buyer.id` | string | Yes | Buyer identification number (max 20 chars) |
| `buyer.name` | string | Yes | Buyer full name or business name (max 300 chars) |
| `buyer.email` | string | Yes | Buyer email — used when the authorization email is sent |
| `buyer.address` | string | No | Buyer address (max 300 chars) |
| `guiaRemision` | string | No | Delivery note number in `NNN-NNN-NNNNNNNNN` format |
| `items` | array | Yes | Replaces all existing line items, including taxes |
| `items[].mainCode` | string | Yes | Product/service main code |
| `items[].auxiliaryCode` | string | No | Secondary code |
| `items[].description` | string | Yes | Description (max 300 chars) |
| `items[].quantity` | string | Yes | Numeric quantity |
| `items[].unitPrice` | string | Yes | Numeric unit price |
| `items[].discount` | string | No | Numeric discount amount |
| `items[].taxes` | array | Yes | At least one tax per item |
| `items[].taxes[].code` | string | Yes | SRI tax type code |
| `items[].taxes[].rateCode` | string | Yes | SRI tax rate code |
| `items[].taxes[].rate` | string | Yes | Tax rate percentage |
| `items[].taxes[].taxableBase` | string | Yes | Amount the tax is applied to |
| `items[].taxes[].taxAmount` | string | Yes | Calculated tax amount |
| `payments` | array | Yes | Replaces all existing payment entries. Sum of `total` must equal the invoice total |
| `payments[].method` | string | Yes | 2-digit SRI payment method code |
| `payments[].total` | string | Yes | Numeric payment amount |
| `payments[].term` | number | No | Payment term length |
| `payments[].termUnit` | string | No | Payment term unit (e.g. `"dias"`, `"meses"`) |
| `additionalInfo` | array | No | Replaces all existing `campoAdicional` entries |

The original payload is available in the `requestPayload` field on the [Get Document](get-document.md) response — use it to pre-fill the corrected request.

## Response

**200 OK**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "SIGNED",
    "issueDate": "15/03/2026",
    "total": "120.00",
    "buyer": {
      "id": "1234567890",
      "idType": "05",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "email": {
      "status": "PENDING"
    }
  }
}
```

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Request body fails field validation |
| `VALIDATION_FAILED` | 400 | Sum of `payments[].total` does not match the calculated invoice total |
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `INVALID_STATE_TRANSITION` | 400 | Document is not in `RETURNED` or `NOT_AUTHORIZED` status |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
