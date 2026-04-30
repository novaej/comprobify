# Resend Verification Email

Resends the verification email to a registered but unverified tenant. Generates a fresh token (invalidating the previous one) and resets the expiry.

```
POST /api/resend-verification
```

## Authentication

None — public endpoint.

## Rate limiting

Two independent limits apply:

- **IP-based:** shared with `POST /api/register` — 5 requests per hour per IP.
- **Per-account cooldown:** 60 seconds between resends for the same email address. Breaching this returns `429`.

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
| `429` | `TOO_MANY_REQUESTS` | IP rate limit exceeded, or 60-second per-account cooldown not yet elapsed |

## Notes

- The old token is immediately invalidated — only the newly issued token will work.
- The new token expires after the configured TTL (default 24 hours).
- The verification link in the resent email uses the same `verificationRedirectUrl` that was set at registration. If none was set, the link goes directly to the API verify endpoint.
- Delivery status is tracked the same way as invoice emails: `verification_email_status` on the tenant row is updated to `SENT`, `DELIVERED`, `FAILED`, or `COMPLAINED` via the Mailgun webhook.
- If `EMAIL_PROVIDER=none`, the token is still regenerated in the database but no email is sent.
