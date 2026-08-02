# Get SRI Responses

Returns the raw SRI SOAP call outcomes recorded for a document — one row per reception (`POST /:accessKey/send`) or authorization (`GET /:accessKey/authorize`) attempt, in reverse chronological order (newest first).

```
GET /v1/documents/:accessKey/sri-responses
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

## Response

**200 OK**

```json
{
  "ok": true,
  "sriResponses": [
    {
      "operationType": "AUTHORIZATION",
      "status": "NO_AUTORIZADO",
      "messages": [
        { "identifier": "45", "message": "RUC no existe", "additionalInfo": null, "type": "ERROR" }
      ],
      "createdAt": "2026-07-05T14:22:00.000Z"
    },
    {
      "operationType": "RECEPTION",
      "status": "RECIBIDA",
      "messages": null,
      "createdAt": "2026-07-05T14:21:00.000Z"
    },
    {
      "operationType": "RECEPTION",
      "status": "HTTP_500",
      "messages": null,
      "createdAt": "2026-07-05T14:20:00.000Z"
    }
  ]
}
```

| Field | Description |
|---|---|
| `operationType` | `RECEPTION` (from `POST /:accessKey/send`) or `AUTHORIZATION` (from `GET /:accessKey/authorize`) |
| `status` | Either the `estado` SRI returned for that call (e.g. `RECIBIDA`, `DEVUELTA`, `AUTORIZADO`, `NO_AUTORIZADO`), or `HTTP_<code>` (e.g. `HTTP_500`) when SRI's own service failed at the transport level and never returned a business-level `estado` at all — a different kind of failure than a rejected document, and typically a transient issue on SRI's side rather than something wrong with the submitted document |
| `messages` | Array of SRI observation/error messages for that call, or `null` if SRI returned none (always `null` for an `HTTP_<code>` status, since no business-level response was ever parsed) |
| `createdAt` | When this call's response was recorded |

The raw SOAP response body is intentionally not included — it's internal diagnostic data, not part of the API contract.

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `accessKey` is not exactly 49 digits |
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
