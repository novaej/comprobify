# Verify Email

Activates a tenant account using the token from the verification email sent at registration. Once verified, the tenant can promote their account to production.

Verification is split into a read-only check and a separate consuming action. This split exists because email link-scanners (e.g. Microsoft Defender/Safe Links on Outlook addresses) prefetch every link in an email with a plain `GET` before the user ever clicks it — a single combined check-and-consume `GET` let a scanner's prefetch burn the token before the real click happened, leaving the user with an `INVALID_OR_EXPIRED_TOKEN` error on their first genuine click.

## Check token validity (non-consuming)

```
GET /v1/verify-email/check?token=<token>
```

Read-only — safe to call repeatedly, including by automated link-scanners. Never activates the account. Call this on page load to show the user whether their link is still valid before they act on it.

### Authentication

None — public endpoint. The token in the query string acts as the credential.

### Query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | string (64-char hex) | Yes | Verification token from the registration email |

### Response

```json
{ "valid": true, "email": "you@example.com" }
```

or, for an invalid/expired/unknown token:

```json
{ "valid": false }
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` is missing, not hexadecimal, or not exactly 64 characters |

## Confirm verification (consuming)

```
POST /v1/verify-email
Content-Type: application/json

{ "token": "<token>" }
```

The actual consuming action — activates the tenant and cannot be triggered by an automated `GET` prefetch. Call this only in response to an explicit user action (e.g. a "Verify my email" button), never automatically on page load.

### Authentication

None — public endpoint. The token in the request body acts as the credential.

### Body parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | string (64-char hex) | Yes | Verification token from the registration email |

### Response

```json
{
  "ok": true,
  "email": "you@example.com",
  "message": "Email verified. You can now promote your account to production."
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` is missing, not hexadecimal, or not exactly 64 characters |
| `400` | `INVALID_OR_EXPIRED_TOKEN` | Token does not match any pending tenant, or has expired |

## Legacy fallback (consuming `GET`)

```
GET /v1/verify-email?token=<token>
```

Combines check-and-consume in a single `GET`, kept for backward compatibility. This is what the verification email links to directly when no `verificationRedirectUrl` was set at registration (e.g. a caller using the API directly rather than through a first-party frontend). New integrations with their own verification page should use the check/confirm pair above instead — a `GET`-only flow remains vulnerable to the link-scanner problem described above.

### Authentication

None — public endpoint. The token in the query string acts as the credential.

### Query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `token` | string (64-char hex) | Yes | Verification token from the registration email |

### Response

```json
{
  "ok": true,
  "email": "you@example.com",
  "message": "Email verified. You can now promote your account to production."
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` is missing, not hexadecimal, or not exactly 64 characters |
| `400` | `INVALID_OR_EXPIRED_TOKEN` | Token does not match any pending tenant, or has expired |

## Notes

- Tokens expire after the configured TTL (default 24 hours). Use `POST /v1/resend-verification` to get a fresh one.
- If `verificationRedirectUrl` was set at registration, the email link points to that URL instead of directly to the API — the frontend at that URL is responsible for reading the `token` query parameter and driving the check → confirm flow above (or falling back to the legacy `GET` if it doesn't implement its own page).
- Verification is a prerequisite for `POST /v1/tenants/promote`. Unverified tenants can use the sandbox but cannot switch to production.
- Activating an account (via either the `POST` confirm or the legacy `GET`) logs an `EMAIL_VERIFIED` event to the tenant event log. The non-consuming check never logs anything.
