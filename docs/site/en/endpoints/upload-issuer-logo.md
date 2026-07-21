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
| `id` | Issuer UUID (from `GET /v1/issuers`) |

## Request body

`multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `logo` | file | Yes | Logo image. Accepted formats: **PNG** (recommended), JPEG, GIF. Max size: **500 KB**. Recommended dimensions: **600 × 170 px**. |

## Response

**200 OK**

```json
{ "ok": true }
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a positive integer |
| `400` | `INVALID_FILE_UPLOAD` | No file provided, file exceeds 500 KB, or unsupported MIME type |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Calling this endpoint again overwrites the existing logo — there is no separate delete endpoint; to remove a logo, re-register or contact support.
- The logo is embedded directly in the PDF at render time. No public URL is exposed.
- The logo can also be supplied at registration time via the optional `logo` file field on `POST /v1/register`.

## Logo sizing guide

The logo renders in the top-left cell of the RIDE PDF header, scaled to fit a **213 × 60 pt** bounding box (aspect ratio ~3.5:1). The image is scaled proportionally — it will never be stretched.

| | Value |
|---|---|
| **Recommended size** | 600 × 170 px |
| **Maximum useful size** | 900 × 250 px (larger adds file size without visible quality gain) |
| **Minimum size** | 213 × 60 px |
| **Aspect ratio** | ~3.5:1 (landscape) |
| **Recommended format** | PNG — supports transparency, lossless, ideal for logos with text or sharp edges |
| **Accepted formats** | PNG, JPEG, GIF |
| **Max file size** | 500 KB |

**Tips:**
- Use PNG with a transparent background so the logo blends naturally with the white PDF background.
- Avoid portrait-oriented images — they will be scaled down to fit the 60 pt height and appear narrow.
- JPEG is fine for photographic logos but may show compression artefacts on text or sharp edges.
- GIF is accepted but limited to 256 colours and no soft transparency — not recommended for modern logos.
