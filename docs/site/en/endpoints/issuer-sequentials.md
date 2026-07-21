# Issuer Sequentials

View and manually correct an issuer's sequential number counters. Sandbox and production are tracked independently (separate PostgreSQL schemas), so both are reported side by side.

## Authentication

`Authorization: Bearer <api-key>`

Both endpoints below take the issuer id as a URL parameter and verify it belongs to your tenant before applying any change.

---

## View current sequentials

```
GET /v1/issuers/:id/sequentials
```

Returns one row per active document type for the issuer, with the current counter value and the sequential each environment would produce next.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Issuer UUID |

### Response

```json
{
  "ok": true,
  "sequentials": [
    {
      "documentType": "01",
      "sandbox": { "current": 12, "next": 13 },
      "production": { "current": 104, "next": 105 }
    },
    {
      "documentType": "04",
      "sandbox": { "current": 0, "next": 1 },
      "production": { "current": 0, "next": 1 }
    }
  ]
}
```

A document type that has never issued a document in an environment reports `current: 0`, `next: 1`.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a positive integer |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

---

## Set the next sequential

```
PATCH /v1/issuers/:id/sequentials/:documentType
```

Manually sets the counter for one document type in one environment, so the next document created picks up `nextSequential`. Typically used to correct a counter after migrating from another invoicing system, or to skip past a block of numbers already used outside the API.

The write locks the counter row (`SELECT ... FOR UPDATE`) inside the same transaction that updates it, so it cannot race against a concurrent `POST /v1/documents` call and produce a duplicate sequential.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Issuer UUID |
| `documentType` | SRI document type code (e.g. `01`) |

### Request body

```json
{
  "environment": "production",
  "nextSequential": 200
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `environment` | string | Yes | `sandbox` or `production` |
| `nextSequential` | integer | Yes | The sequential the next document of this type/environment should receive. Must be greater than the counter's current value. |

### Response

**200 OK**

```json
{ "ok": true }
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `documentType` is not a supported type, `environment` is not `sandbox`/`production`, or `nextSequential` is not a positive integer |
| `400` | `SEQUENTIAL_CANNOT_DECREASE` | `nextSequential` does not exceed the counter's current value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
