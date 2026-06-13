# Get XML

Downloads the document XML.

```
GET /v1/documents/:accessKey/xml
```

- For `AUTHORIZED` documents: returns the SRI authorization XML (includes the authorization number and timestamp wrapped around the signed document).
- For all other statuses: returns the signed XML as submitted to SRI.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (numeric id from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

## Response

**200 OK** — XML file download.

```
Content-Type: application/xml
Content-Disposition: attachment; filename="<accessKey>.xml"
```

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
