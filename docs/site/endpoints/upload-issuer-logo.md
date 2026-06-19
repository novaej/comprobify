# Upload Issuer Logo

Uploads or replaces the logo for an issuer. The logo is stored in the database and rendered automatically in the top-left corner of every RIDE PDF generated for that issuer — including PDFs sent as email attachments on authorization.

```
PATCH /v1/issuers/:id/logo
```

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id (from `GET /v1/issuers`) |

## Request body

`multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `logo` | file | Yes | Logo image. Accepted formats: PNG, JPEG, GIF. Max size: 500 KB. |

## Response

**200 OK**

```json
{ "ok": true }
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `id` is not a positive integer |
| `400` | `INVALID_FILE_UPLOAD` | No file provided, file exceeds 500 KB, or unsupported MIME type |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Calling this endpoint again overwrites the existing logo — there is no separate delete endpoint; to remove a logo, re-register or contact support.
- The logo is embedded directly in the PDF at render time. No public URL is exposed.
- Logo dimensions are scaled to fit within a `535 × 60 pt` bounding box in the header. Use a landscape-oriented image for best results.
- The logo can also be supplied at registration time via the optional `logo` file field on `POST /v1/register`.
