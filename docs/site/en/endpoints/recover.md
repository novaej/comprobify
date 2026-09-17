# Recover account

```
POST /v1/recover
```

Recovers access to an existing account when the API key was lost, by matching the P12 certificate used at registration.

## This is not a third-party-callable endpoint

Like [Register](register.md), `POST /v1/recover` requires a valid `X-Internal-Service-Secret` header — a credential only the Comprobify web app holds. A request without it is rejected with `403 INTERNAL_SERVICE_ONLY`.

**If you've lost access to your account, use the recovery flow in the Comprobify web app.** It uploads your P12 certificate on your behalf and, on a match, the API revokes the old key for your account's current environment (sandbox or production) and issues a new one. If your account is already linked to the web app — the normal case for anyone who registered there — that new key is stored encrypted and **never shown to you either**, the same as at registration (see [Getting Started](../getting-started.md)). You only see the key's text when linking, for the first time, an account that was originally created outside the web app.

## Related

- [Register](register.md) — also frontend-only, for the same reason
- [Verify Email](verify-email.md) — recovery also forces re-verification; the check endpoint there stays public
