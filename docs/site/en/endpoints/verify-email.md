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

## Confirming verification

The actual consuming action (`POST /v1/verify-email`) — the one that activates the tenant — is only callable by the Comprobify web app, the same as account creation itself (see [Register](register.md)). It isn't documented here as a third-party-callable endpoint. If you've built your own verification page against `verificationRedirectUrl`, use the check endpoint above to validate the token, then send the user back to the Comprobify web app to actually confirm.

### Notes

- Tokens expire after the configured TTL (default 24 hours). A fresh verification email is only ever sent by the Comprobify web app.
- The verification email always links to the URL the account was created with (`verificationRedirectUrl`) — there is no API-hosted verification page.
- Verification is a prerequisite for promoting an account to production. Unverified tenants can use the sandbox but cannot switch to production.
- Activating an account logs an `EMAIL_VERIFIED` event to the tenant event log. The non-consuming check above never logs anything.
