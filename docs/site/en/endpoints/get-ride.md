# Get RIDE (PDF)

Downloads the RIDE (Representación Impresa del Documento Electrónico) as a PDF. Only available for authorized documents.

```
GET /v1/documents/:accessKey/ride
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of an `AUTHORIZED` document |

## Response

**200 OK** — PDF file download.

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="RIDE-<accessKey>.pdf"
```

The PDF is generated on demand and is not stored. Each request generates a fresh copy.

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `BAD_REQUEST` | 400 | Document is not in `AUTHORIZED` status |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
