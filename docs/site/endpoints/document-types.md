# Issuer Document Types

Manage which SRI document types an issuer is allowed to process. Document type eligibility is checked at invoice creation time — attempting to create a document of a disallowed type returns 400.

## Authentication

`Authorization: Bearer <api-key>`

All endpoints below take the issuer id as a URL parameter and verify it belongs to your tenant before applying any change.

---

## List document types

```
GET /v1/issuers/:id/document-types
```

Returns the active document types for the named issuer.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id (from `GET /v1/issuers`) |

### Response

```json
{
  "ok": true,
  "documentTypes": ["01"]
}
```

---

## Add a document type

```
POST /v1/issuers/:id/document-types
```

Enables a new document type for the issuer. If the type was previously removed, it is reactivated.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id |

### Request body

```json
{
  "documentType": "01"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `documentType` | string | Yes | SRI document type code (see supported types below) |

### Response

Returns the full updated list of active document types.

```json
{
  "ok": true,
  "documentTypes": ["01"]
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `documentType` is missing or not a supported type |
| `403` | `FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `NOT_FOUND` | Issuer id does not exist |

---

## Remove a document type

```
DELETE /v1/issuers/:id/document-types/:code
```

Disables a document type for the issuer. The last active type cannot be removed.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id |
| `code` | Document type code to remove (e.g. `01`) |

### Response

Returns the full updated list of active document types.

```json
{
  "ok": true,
  "documentTypes": ["01"]
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `code` is not a supported type |
| `400` | `BAD_REQUEST` | Attempting to remove the last active document type |
| `403` | `FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `NOT_FOUND` | Issuer id does not exist, or the document type is not currently active for this issuer |

---

## Supported document types

| Code | Description |
|---|---|
| `01` | Factura (Invoice) |
