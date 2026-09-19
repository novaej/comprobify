# Register

```
POST /v1/register
```

Creates a tenant, issuer, and sandbox API key in one call.

## This is not a third-party-callable endpoint

`POST /v1/register` requires a valid `X-Internal-Service-Secret` header, a credential only the Comprobify web app holds. A request without it is rejected with `403 INTERNAL_SERVICE_ONLY` — there is no way for a third-party integration to create a Comprobify account directly against this API.

**To get an account, sign up at the Comprobify web app.** Once your account exists, the API creates a fully-permissioned key for it — but the web app **never shows you its text**: it stores it encrypted and uses it internally to operate your dashboard. See [Getting Started](../getting-started.md) for what that means if you need to integrate your own system directly against the API.

If you're building your own frontend on top of Comprobify and need your users to sign up without visiting the Comprobify web app yourself, get in touch with support — direct registration access is a business decision, not something self-service.

## Related

- [Recover Account](recover.md) — also frontend-only, for the same reason
- [Verify Email](verify-email.md) — the one piece of the account-creation flow that stays public
