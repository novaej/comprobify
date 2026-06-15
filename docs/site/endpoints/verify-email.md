# Verify Email

Activates a tenant account using the token from the verification email sent at registration. Once verified, the tenant can promote their account to production.

```
GET /v1/verify-email?token=<token>
```

## Authentication

None — public endpoint. The token in the query string acts as the credential.

## Query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | string (64-char hex) | Yes | Verification token from the registration email |

## Response

```json
{
  "ok": true,
  "email": "you@example.com",
  "message": "Email verified. You can now promote your account to production."
}
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `token` is missing, not hexadecimal, or not exactly 64 characters |
| `400` | `INVALID_OR_EXPIRED_TOKEN` | Token does not match any pending tenant, or has expired |

## Notes

- Tokens expire after the configured TTL (default 24 hours). Use `POST /v1/resend-verification` to get a fresh one.
- If `verificationRedirectUrl` was set at registration, the email link points to that URL instead of directly to this endpoint — the frontend is then responsible for calling `GET /v1/verify-email?token=<token>` with the token it receives.
- Verification is a prerequisite for `POST /v1/tenants/promote`. Unverified tenants can use the sandbox but cannot switch to production.
- Activating an account logs an `EMAIL_VERIFIED` event to the tenant event log.
