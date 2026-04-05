# Create Invoice

Creates, validates, and signs a new electronic invoice.

```
POST /api/documents
```

## Authentication

`Authorization: Bearer <api-key>`

## Headers

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | Bearer API key |
| `Content-Type` | Yes | `application/json` |
| `Idempotency-Key` | No | Unique string (max 255 chars) — see [idempotency](#idempotency) |

## Request body

```json
{
  "documentType": "01",
  "issueDate": "15/03/2026",
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

### Field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `documentType` | string | Yes | Document type code. Currently only `"01"` (factura) is supported |
| `issueDate` | string | No | Date in `DD/MM/YYYY` format. Defaults to today |
| `buyer.idType` | string | Yes | 2-digit SRI identification type code (e.g. `"05"` = cedula, `"04"` = RUC) |
| `buyer.id` | string | Yes | Buyer identification number (max 20 chars) |
| `buyer.name` | string | Yes | Buyer full name or business name (max 300 chars) |
| `buyer.email` | string | Yes | Buyer email — RIDE and XML are sent here on authorization |
| `buyer.address` | string | No | Buyer address (max 300 chars) |
| `items` | array | Yes | At least one item required |
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
| `payments` | array | Yes | At least one payment required |
| `payments[].method` | string | Yes | 2-digit SRI payment method code |
| `payments[].total` | string | Yes | Numeric payment amount |
| `payments[].term` | number | No | Payment term (days) |
| `payments[].termUnit` | string | No | Term unit (e.g. `"dias"`) |
| `additionalInfo` | array | No | Key-value pairs included in the XML as `campoAdicional` |

## Response

**201 Created** — new document created.
**200 OK** — returned when the same `Idempotency-Key` + identical payload was already processed.

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "SIGNED",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "email": {
      "status": "PENDING"
    }
  }
}
```

## Idempotency

Include an `Idempotency-Key` header to make creation idempotent. Generate the key once per intended invoice and reuse it across retries:

- Same key + same payload → returns the existing document (no duplicate created)
- Same key + different payload → `409 Conflict`

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Request body fails field validation |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `CONFLICT` | 409 | Idempotency key reused with a different payload |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
