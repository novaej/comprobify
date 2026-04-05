# Error Format

All error responses use [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807) with `Content-Type: application/problem+json`.

## Response shape

```json
{
  "type":     "https://docs.comprobify.com/errors/validation-error",
  "title":    "Validation Failed",
  "status":   400,
  "code":     "VALIDATION_FAILED",
  "detail":   "Validation failed",
  "instance": "/api/documents"
}
```

| Field | Description |
|---|---|
| `type` | URL linking to the documentation page for this error type (this site) |
| `title` | Short, stable description of the error type |
| `status` | HTTP status code (same as the response status) |
| `code` | Stable machine-readable key — use this for localization |
| `detail` | Human-readable explanation of this specific occurrence |
| `instance` | The request path that produced the error |

## Using `code` for localization

The `code` field is the stable key your client application should use to look up localized messages. It never changes for a given error type, regardless of the `detail` text.

```js
const messages = {
  VALIDATION_FAILED:    'Por favor corrija los campos indicados.',
  NOT_FOUND:            'El documento solicitado no existe.',
  UNAUTHORIZED:         'Clave API inválida o revocada.',
  CONFLICT:             'Ya existe un documento con esa clave de idempotencia.',
  SRI_SUBMISSION_FAILED: 'Error al comunicarse con el SRI.',
  INTERNAL_ERROR:       'Error interno. Por favor intente nuevamente.',
};

const message = messages[error.code] ?? error.detail;
```

## Validation errors

When `code` is `VALIDATION_FAILED`, an additional `errors` array lists each field that failed:

```json
{
  "type":   "https://docs.comprobify.com/errors/validation-error",
  "title":  "Validation Failed",
  "status": 400,
  "code":   "VALIDATION_FAILED",
  "detail": "Validation failed",
  "instance": "/api/documents",
  "errors": [
    {
      "field":   "buyer.email",
      "message": "Buyer email is required and must be a valid email address",
      "code":    "buyer.email",
      "value":   ""
    }
  ]
}
```

Each entry in `errors` has:

| Field | Description |
|---|---|
| `field` | The request body path that failed (e.g. `buyer.email`, `items[0].taxes[0].code`) |
| `message` | English description of the failure |
| `code` | Field path with array indices stripped — stable key for field-level localization (e.g. `items.taxes.code`) |
| `value` | The value that was submitted |

## SRI errors

When `code` is `SRI_SUBMISSION_FAILED`, an additional `sriMessages` array contains the raw messages returned by the SRI SOAP service:

```json
{
  "type":   "https://docs.comprobify.com/errors/sri-error",
  "title":  "SRI Submission Failed",
  "status": 502,
  "code":   "SRI_SUBMISSION_FAILED",
  "detail": "SRI rejected the document",
  "instance": "/api/documents/1503.../send",
  "sriMessages": [
    {
      "identifier": "35",
      "message":    "ARCHIVO NO CUMPLE ESTRUCTURA XML",
      "type":       "ERROR"
    }
  ]
}
```

## All error codes

| Code | Status | Description |
|---|---|---|
| [`VALIDATION_FAILED`](validation-error.md) | 400 | One or more request fields failed validation |
| [`BAD_REQUEST`](bad-request.md) | 400 | Malformed request or invalid operation for current state |
| [`UNAUTHORIZED`](unauthorized.md) | 401 | Missing or invalid API key |
| [`NOT_FOUND`](not-found.md) | 404 | Requested resource does not exist |
| [`CONFLICT`](conflict.md) | 409 | Idempotency key conflict |
| [`SRI_SUBMISSION_FAILED`](sri-error.md) | 502 | Error communicating with or receiving from SRI |
| [`INTERNAL_ERROR`](internal-error.md) | 500 | Unexpected server error |
