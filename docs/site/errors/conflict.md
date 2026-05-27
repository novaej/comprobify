# Conflict

**Status:** `409 Conflict`

A uniqueness or state conflict prevented the operation from completing.

## Codes

### `ALREADY_VERIFIED`

`POST /api/resend-verification` was called for an email address whose account is already active (email already verified). There is nothing to resend.

**What to do:** No action needed — the account is verified and can be used normally.

### `CONFLICT` (fallback)

An `Idempotency-Key` header was supplied with a value that has already been used for a **different** request payload, or another uniqueness constraint was violated. Read `detail`.

**What to do:**

- **Idempotency key reuse** — Each `Idempotency-Key` must be unique per intended invoice. If you are retrying the **same** invoice after a failure, reuse the same key **and** the same payload — the API will return the existing document (200). If you intend to create a new invoice, generate a fresh key (e.g. a new UUID).

- **Other conflicts** — e.g. duplicate issuer `(branch_code, issue_point_code)` pair. Read `detail` for the specific constraint.

## Example responses

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/conflict",
  "title":    "Conflict",
  "status":   409,
  "code":     "ALREADY_VERIFIED",
  "detail":   "This account is already verified.",
  "instance": "/api/resend-verification"
}
```

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/conflict",
  "title":    "Conflict",
  "status":   409,
  "code":     "CONFLICT",
  "detail":   "Idempotency-Key reuse: the request body does not match the original request",
  "instance": "/api/documents"
}
```
