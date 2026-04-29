# Issuer Document Types

Manage which SRI document types an issuer is allowed to process. Document type eligibility is checked at invoice creation time — attempting to create a document of a disallowed type returns 400.

## Authentication

`Authorization: Bearer <api-key>`

---

## List document types

```
GET /api/issuers/document-types
```

Returns the active document types for the authenticated issuer.

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
POST /api/issuers/document-types
```

Enables a new document type for the issuer. If the type was previously removed, it is reactivated.

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
| `400` | `VALIDATION_ERROR` | `documentType` is missing or not a supported type |

---

## Remove a document type

```
DELETE /api/issuers/document-types/:code
```

Disables a document type for the issuer. The last active type cannot be removed.

### Path parameters

| Parameter | Description |
|---|---|
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
| `400` | `VALIDATION_ERROR` | `code` is not a supported type |
| `400` | `BAD_REQUEST` | Attempting to remove the last active document type |
| `404` | `NOT_FOUND` | The document type is not currently active for this issuer |

---

## Supported document types

| Code | Description |
|---|---|
| `01` | Factura (Invoice) |
