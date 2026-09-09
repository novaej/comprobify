# Recover account

```
POST /v1/recover
```

Recovers access to an existing account when the API key was lost, by matching the P12 certificate used at registration.

## This is not a third-party-callable endpoint

Like [Register](register.md), `POST /v1/recover` requires a valid `X-Internal-Service-Secret` header — a credential only the Comprobify web app holds. A request without it is rejected with `403 INTERNAL_SERVICE_ONLY`.

**If you've lost your API key, use the account recovery flow in the Comprobify web app.** It uploads your P12 certificate on your behalf and, on a match, issues you a fresh key for your account's current environment (sandbox or production) — the same outcome this endpoint always produced, just initiated from the app instead of directly against the API.

## Related

- [Register](register.md) — also frontend-only, for the same reason
- [Verify Email](verify-email.md) — recovery also forces re-verification; the check endpoint there stays public
