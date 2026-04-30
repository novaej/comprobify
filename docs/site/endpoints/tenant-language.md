# Update Preferred Language

Updates the preferred language for the authenticated tenant. The language is used for all outgoing emails (verification, and future document emails).

```
PATCH /api/tenants/language
```

## Authentication

Bearer token — API key required.

## Request body

```json
{
  "language": "en"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `language` | string | Yes | Language code. Supported values: `es`, `en` |

## Response

```json
{
  "ok": true
}
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `language` is missing or not a supported value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Account is suspended |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- The language set at registration (`POST /api/register`) is used as the initial value (default `es`).
- This endpoint allows updating the language after registration without re-registering.
- Supported languages: `es` (Spanish), `en` (English).
- The language preference applies to all email types — currently verification emails, and document emails in a future release.
