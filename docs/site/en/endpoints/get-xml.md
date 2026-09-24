# Get XML

Downloads the document XML.

```
GET /v1/documents/:accessKey/xml
```

- For `AUTHORIZED` documents: returns the SRI authorization XML (includes the authorization number and timestamp wrapped around the signed document).
- For all other statuses: returns the signed XML as submitted to SRI.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

### Example

```http
GET /v1/documents/1503202601179234567800110010010000000011234567810/xml
Authorization: Bearer <your-api-key>
X-Issuer-Id: 00000000-0000-0000-0000-000000000001
```

## Response

**200 OK** — XML file download.

```
Content-Type: application/xml
Content-Disposition: attachment; filename="<accessKey>.xml"
```

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
