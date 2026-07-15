# Renew Issuer Certificate

Replaces the P12 certificate (private key + X.509 cert) stored for an issuer — for example, when the existing certificate has expired or is about to. Only that issuer's row is updated; sibling branches that previously inherited the certificate via `sourceIssuerId` keep their own copy until renewed individually.

```
PATCH /v1/issuers/:id/certificate
```

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id (from `GET /v1/issuers`) |

## Request body

`multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `cert` | file | Yes | P12/PFX certificate file issued by an authorized Ecuadorian CA (BANCO CENTRAL or SECURITY DATA). |
| `certPassword` | string | No | Password protecting the P12 file, if any. |

## Response

**200 OK**

```json
{ "ok": true, "certFingerprint": "a1b2c3...", "certExpiry": "2028-06-23T00:00:00.000Z" }
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a positive integer |
| `400` | `INVALID_FILE_UPLOAD` | No `cert` file provided |
| `400` | `CERTIFICATE_INVALID` | File is not a valid PKCS#12 archive |
| `400` | `CERTIFICATE_PASSWORD_INVALID` | Wrong `certPassword` |
| `400` | `CERTIFICATE_KEY_NOT_FOUND` | No BANCO CENTRAL/SECURITY DATA signing key bag found in the P12 |
| `400` | `CERTIFICATE_EXPIRED` | The uploaded certificate is itself already expired |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- **Does not affect already-signed documents.** Each signed invoice embeds its own copy of the signing certificate inside the XML signature (`<ds:X509Certificate>`) at signing time — it is not a live reference to the issuer row. Renewing the certificate only changes what is used for *future* signing: new `POST /v1/documents` calls and any subsequent rebuilds of `RETURNED`/`NOT_AUTHORIZED` documents.
- Renewal is scoped to the single issuer in the URL. If the same P12 covers multiple branches/issue points under the same RUC, renew each issuer row separately (or pass the same file to each).
- An admin override exists at `PATCH /v1/admin/issuers/:id/certificate` (no tenant ownership check).
