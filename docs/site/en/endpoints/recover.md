# Recover account

Recovers access to an existing account when the API key was lost. Requires the same P12 certificate used at registration — the API key is only revoked and replaced when the uploaded certificate matches the one on file for that account.

```
POST /v1/recover
```

## Authentication

None — public endpoint.

## Rate limiting

Shared with `POST /v1/register` and `POST /v1/resend-verification` — 5 requests per hour per IP.

## Request body

`multipart/form-data` (required — a P12 certificate file must be included).

| Field | Type | Required | Description |
|---|---|---|---|
| `cert` | file | Yes | P12 certificate file from SRI — must match the certificate on file for the account |
| `certPassword` | string | No | P12 password (omit if none) |
| `email` | string | Yes | Email of the account to recover |

## Response

This endpoint **always returns the same generic response shape** unless the certificate genuinely matches an existing account — see "Anti-enumeration behavior" below.

### 200 OK — certificate matches an existing account

The account's current API key for its actual current environment (sandbox or production) is revoked and a new one is issued immediately.

```json
{
  "ok": true,
  "tenant": {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "you@company.com",
    "subscriptionTier": "FREE",
    "status": "PENDING_VERIFICATION",
    "documentQuota": 100,
    "documentCount": 12
  },
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000001",
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": null,
    "branchCode": "001",
    "issuePointCode": "001",
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  },
  "apiKey": "abc123...",
  "environment": "sandbox"
}
```

`environment` reflects the account's **actual current** environment (`"sandbox"` or `"production"`) — a tenant already promoted to production recovers their production key, not a sandbox one.

**As extra validation, the account is also moved back to `PENDING_VERIFICATION`** — matching the certificate only proves you have the P12 file, not that you control the registered email inbox. A verification email with a fresh link is sent in the background (it does not block this response). The returned API key already works for sandbox document creation, but actions that require an `ACTIVE` account — creating a branch, promoting to production, starting a subscription, or minting additional named keys — are blocked until you click the link in that email. See [`GET /v1/verify-email`](./verify-email.md).

### 200 OK — every other case

```json
{
  "ok": true,
  "message": "If this email and certificate match an existing account, a new key has been issued."
}
```

This same generic response is returned when the email isn't registered, when the account has no issuer (inconsistent state), or when the certificate doesn't match the one on file — deliberately, so none of those cases is distinguishable from the others (see below).

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Missing email or P12 file, or invalid format |
| `400` | `CERTIFICATE_INVALID` / `CERTIFICATE_PASSWORD_INVALID` / `CERTIFICATE_KEY_NOT_FOUND` / `CERTIFICATE_EXPIRED` | The P12 file is corrupt, the password is wrong, or the certificate has expired — these errors happen **before** any account lookup, so they never reveal whether the email exists |
| `403` | `ACCOUNT_SUSPENDED` | The account is suspended — only ever revealed when the submitted certificate does match the one on file (see below) |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Anti-enumeration behavior

This endpoint is deliberately designed so a caller **without the correct certificate** cannot distinguish between:

- the email isn't registered
- the email is registered but the account has no issuer (inconsistent state)
- the email is registered but the submitted certificate doesn't match

All three return exactly the same generic `200` response — no key, nothing revoked or issued. A matching certificate is the same proof of ownership fresh registration accepts — only then is a key issued, and only then is account suspension ever revealed.

Certificate errors (corrupt file, wrong password, expired certificate) are validated **before** any lookup by email, so they don't correlate with account existence either.

## Notes

- Don't confuse this with `POST /v1/register` — that endpoint is for new accounts only; if the email already exists, it rejects with `409 CONFLICT` and never revokes or issues a key.
- The notice email reuses the exact same mechanism as `POST /v1/resend-verification` (same token, same template) and the same redemption endpoint, `GET /v1/verify-email`, which flips the account back to `ACTIVE`. If you don't have email access, an administrator can also verify the account manually.
- This re-verification requirement applies even if the account was already `ACTIVE` before recovery — a certificate match alone is no longer enough to keep full account privileges without also confirming email access.
