# Update Preferred Language

Updates the preferred language for the authenticated tenant. The language is used for all emails Comprobify sends on your account's behalf: verification, notifications, and the email for each authorized document.

```
PATCH /v1/tenants/language
```

## Authentication

Bearer token — API key with the `tenant:manage` scope required.

## Request body

```json
{
  "language": "en"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `language` | string | Yes | Language code. Supported values: `es`, `en` |

## Response

```json
{
  "ok": true
}
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `language` is missing or not a supported value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ACCOUNT_SUSPENDED` | Account is suspended |
| `403` | `INSUFFICIENT_SCOPE` | The API key lacks the `tenant:manage` scope |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- The language set at registration is used as the initial value (default `es`).
- This endpoint allows updating the language after registration without re-registering.
- Supported languages: `es` (Spanish), `en` (English).
- It applies to every email Comprobify sends on your account's behalf: verification emails, notification emails (payments, renewals, price changes), and the email with the RIDE and XML that the buyer receives for each authorized document. That last one uses **your account's** language, not the buyer's — there is no buyer-language field.
- **The web app calls it automatically.** When you change the interface language in the web app, it uses this endpoint for you and stores that language as the account's, so emails follow the language you picked there. Only the account owner (someone who can manage the account) does this; if another team member changes the language, only their own view changes and the email language is left alone.
- If you integrate your own system (Starter plans and up) you can call it directly with a key that has the `tenant:manage` scope.
