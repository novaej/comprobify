# Resend Verification Email

```
POST /v1/resend-verification
```

Resends the verification email to a registered but unverified tenant.

## This is not a third-party-callable endpoint

Like [Register](register.md), `POST /v1/resend-verification` requires a valid `X-Internal-Service-Secret` header — a credential only the Comprobify web app holds. A request without it is rejected with `403 INTERNAL_SERVICE_ONLY`.

**If you never received your verification email, or the link expired, request a new one from the Comprobify web app.**

## Related

- [Register](register.md) — also frontend-only, for the same reason
- [Verify Email](verify-email.md) — the check endpoint there stays public
