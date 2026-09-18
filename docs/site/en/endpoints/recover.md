# Recover account

```
POST /v1/recover
```

Re-establishes the Comprobify web app's link to your account, by matching the P12 certificate used at registration.

## This is not a third-party-callable endpoint

Like [Register](register.md), `POST /v1/recover` requires a valid `X-Internal-Service-Secret` header — a credential only the Comprobify web app holds. A request without it is rejected with `403 INTERNAL_SERVICE_ONLY`.

**If the Comprobify web app ever shows your account as unlinked, use its recovery flow to fix it.** It uploads your P12 certificate on your behalf and, on a match, the API revokes the old key for your account's current environment (sandbox or production) and issues a new one — the API key itself is never shown to you, whether this is the first time your account is being linked to the web app or a resync of a link that already existed (see [Getting Started](../getting-started.md)). Note this doesn't help if you've simply forgotten your web app password — that's handled by the web app's own password reset, unrelated to this endpoint.

## Related

- [Register](register.md) — also frontend-only, for the same reason
- [Verify Email](verify-email.md) — recovery also forces re-verification; the check endpoint there stays public
