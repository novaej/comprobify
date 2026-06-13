# Resend Verification Email

Resends the verification email to a registered but unverified tenant. Generates a fresh token (invalidating the previous one) and resets the expiry.

```
POST /v1/resend-verification
```

## Authentication

None — public endpoint.

## Rate limiting

Two independent limits apply:

- **IP-based:** shared with `POST /v1/register` — 5 requests per hour per IP.
- **Per-account cooldown:** 60 seconds between resends for the same email address. Breaching this returns `429`.

## Request body

```json
{
  "email": "your@email.com",
  "verificationRedirectUrl": "https://app.example.com/verify"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Email address used at registration |
| `verificationRedirectUrl` | string (URL) | No | If provided, overrides the redirect URL embedded in the verification link. Must be `https` in production. Omit to keep the URL set at registration. |

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
| `429` | `TOO_MANY_REQUESTS` | IP rate limit exceeded, or 60-second per-account cooldown not yet elapsed |

## Notes

- The old token is immediately invalidated — only the newly issued token will work.
- The new token expires after the configured TTL (default 24 hours).
- If `verificationRedirectUrl` is supplied, it overwrites the value stored on the tenant and is used for all subsequent verification emails including future resends. Omit the field to keep the existing URL unchanged.
- Delivery status is tracked the same way as invoice emails: `verification_email_status` on the tenant row is updated to `SENT`, `DELIVERED`, `FAILED`, or `COMPLAINED` via the Mailgun webhook.
- If `EMAIL_PROVIDER=none`, the token is still regenerated in the database but no email is sent.
