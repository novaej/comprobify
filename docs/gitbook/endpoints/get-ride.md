# Get RIDE (PDF)

Downloads the RIDE (Representación Impresa del Documento Electrónico) as a PDF. Only available for authorized documents.

```
GET /api/documents/:accessKey/ride
```

## Authentication

`Authorization: Bearer <api-key>`

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
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
| `BAD_REQUEST` | 400 | Document is not in `AUTHORIZED` status |
