# Resend Verification Email

Resends the verification email to a registered but unverified tenant. Generates a fresh token with a new 24-hour expiry.

```
POST /api/resend-verification
```

## Authentication

None — public endpoint.

## Rate limiting

Shared with `POST /api/register` — 5 requests per hour per IP.

## Request body

```json
{
  "email": "your@email.com"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Email address used at registration |

## Response

```json
{
  "ok": true,
  "message": "If that email is registered and unverified, a new verification email has been sent."
}
```

The message is intentionally generic — the endpoint does not reveal whether the email exists in the system.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `email` field is missing or invalid |
| `409` | `CONFLICT` | The account is already verified |
| `403` | `FORBIDDEN` | The account has been suspended |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- The old token is immediately invalidated — only the newly issued token will work.
- Delivery status is tracked the same way as invoice emails: `verification_email_status` on the tenant row is updated to `SENT`, `DELIVERED`, `FAILED`, or `COMPLAINED` via the Mailgun webhook.
- If `EMAIL_PROVIDER=none`, the token is still regenerated in the database but no email is sent.
