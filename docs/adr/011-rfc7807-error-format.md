# ADR-011: RFC 7807 Problem Details for Error Responses

## Status
Accepted

## Date
2026-04-04

## Context

The API was originally designed as a single-tenant internal tool. Error responses used a simple proprietary shape:

```json
{ "ok": false, "message": "...", "errors": [...], "sriMessages": [...] }
```

The requirements changed: the API is intended to become a core service consumed by multiple independent client applications, with OpenAPI documentation for external integrators. Two gaps emerged:

1. **No stable machine-readable error classification.** Clients had to parse free-text `message` strings to distinguish a validation error from an auth error or an SRI rejection. This makes programmatic error handling brittle and tightly coupled to English prose.

2. **No i18n support.** Client applications need to display error messages in the user's language. The API returned human-readable English strings with no stable key clients could map to their own translation tables.

## Decision

Adopt [RFC 7807 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807) as the error response format for all `4xx` and `5xx` responses.

### Response shape

```json
{
  "type":     "/problems/validation-error",
  "title":    "Validation Failed",
  "status":   400,
  "code":     "VALIDATION_FAILED",
  "detail":   "Validation failed",
  "instance": "/api/documents",
  "errors": [
    { "field": "buyer.email", "message": "Buyer email is required and must be a valid email address", "code": "buyer.email" }
  ]
}
```

**Standard RFC 7807 fields:**

| Field | Purpose |
|---|---|
| `type` | URI identifying the problem class. Relative URIs (`/problems/…`) are valid per the spec. |
| `title` | Short, human-readable summary of the problem type. Stable — same for all occurrences of the same `type`. |
| `status` | HTTP status code, echoed in the body for logging convenience. |
| `detail` | Human-readable explanation of this specific occurrence. May vary per request. |
| `instance` | `req.originalUrl` — identifies the specific request that produced the error. Useful for correlating logs. |

**Extension fields (domain-specific):**

| Field | Present on | Purpose |
|---|---|---|
| `code` | All errors | SCREAMING_SNAKE_CASE stable key. Client i18n tables map this to a localised message. |
| `errors[]` | `ValidationError` only | Per-field details. Each entry has `field`, `message`, and `code` (field path with array indices stripped, e.g. `items.taxes.code`). |
| `sriMessages[]` | `SriError` only | Raw messages returned by the SRI SOAP service. |

**Content-Type:** `application/problem+json`

### Error class codes

`AppError` derives `code`, `type`, and `title` automatically from the HTTP status code:

| Status | `code` | `type` |
|---|---|---|
| 400 | `BAD_REQUEST` | `/problems/bad-request` |
| 401 | `UNAUTHORIZED` | `/problems/unauthorized` |
| 403 | `FORBIDDEN` | `/problems/forbidden` |
| 404 | `NOT_FOUND` | `/problems/not-found` |
| 409 | `CONFLICT` | `/problems/conflict` |
| 429 | `TOO_MANY_REQUESTS` | `/problems/too-many-requests` |
| 500 | `INTERNAL_ERROR` | `/problems/internal-error` |
| 502 | `BAD_GATEWAY` | `/problems/bad-gateway` |

`ValidationError` and `SriError` override with domain-specific values (`VALIDATION_FAILED`, `SRI_SUBMISSION_FAILED`) since their HTTP status codes alone do not carry enough meaning.

### Field-level i18n codes

Validation field errors derive `code` from the field path by stripping array indices:

```
items[0].taxes[1].code  →  items.taxes.code
buyer.email             →  buyer.email
```

This produces stable, predictable keys across requests regardless of which array element failed. A body-level custom validator (no field path) gets `code: "general"`.

## Consequences

### Positive
- All error responses follow a single, documented shape that clients can parse mechanically.
- The `code` field gives client applications a stable, language-agnostic key for i18n lookups without parsing English prose.
- `type` URIs are directly referenceable in OpenAPI response schemas.
- `instance` ties every error to the exact request URL, improving debuggability without server-side log correlation.
- `AppError` subclasses that are not yet given explicit codes still produce reasonable defaults derived from the HTTP status — no existing call sites needed to change.

### Negative
- Breaking change: existing consumers parsing `ok`, `message` fields will break.
- The `type` URI scheme uses relative paths (`/problems/…`), which are valid per RFC 7807 but not dereferenceable. Absolute URIs pointing to documentation pages would be more useful to external consumers but require a stable public domain.

### Mitigation
- The breaking change was acceptable because all current consumers are internal and under our control.
- Relative `type` URIs can be promoted to absolute URIs in a future change without altering the semantics.

### Alternatives Considered
- **Keep the proprietary shape, add a `code` field only**: Solves the i18n problem without the RFC 7807 overhead. Rejected because the RFC 7807 envelope (`type`, `title`, `instance`) costs almost nothing to add and buys OpenAPI compatibility and a standard clients already understand.
- **Use HTTP status codes as the i18n key**: Status codes are too coarse — both `ValidationError` (malformed request) and `ConflictError` (duplicate idempotency key) are 400/409 but need different client messages. Rejected.
- **Return i18n strings directly from the API**: Would require the API to know about every client's locale, adding a localisation burden to the server. Rejected — the API returns stable codes; clients own their localisation.
