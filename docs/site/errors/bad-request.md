# Bad Request

**Status:** `400 Bad Request`

The request is syntactically valid but cannot be processed in the current context. Every 400 error carries a specific `code` — use it to handle each case programmatically without parsing the `detail` string.

## Codes

### `CERTIFICATE_INVALID`

The uploaded P12 file could not be parsed. The file may be corrupted, truncated, or not a valid PKCS#12 archive.

**What to do:** Export a fresh P12 from your certificate authority and re-upload it.

### `CERTIFICATE_PASSWORD_INVALID`

The password supplied for the P12 file is incorrect.

**What to do:** Verify the password and retry. Note that passwords are case-sensitive.

### `CERTIFICATE_KEY_NOT_FOUND`

The P12 archive was parsed successfully but does not contain a recognisable signing key bag. The API supports **BANCO CENTRAL** and **SECURITY DATA** certificate formats.

**What to do:** Ensure the P12 was exported from a compatible CA with the private key included.

### `CERTIFICATE_EXPIRED`

The certificate's `notAfter` date is in the past. The `detail` field includes the exact expiry date.

**What to do:** Renew the certificate with your CA, then upload the new P12 to the issuer. All new documents will use the updated certificate immediately.

### `ISSUER_ID_REQUIRED`

The `X-Issuer-Id` request header is missing. Every document-creation and document-management request must specify which issuer is being targeted.

**What to do:** Add `X-Issuer-Id: <issuer-id>` to the request. Get the IDs for your tenant's issuers with `GET /v1/issuers`.

### `ISSUER_ID_INVALID`

The `X-Issuer-Id` header value is not a valid positive integer (e.g. `abc`, `0`, `-5`).

**What to do:** Supply the numeric issuer ID returned by `GET /v1/issuers`.

### `INVALID_OR_EXPIRED_TOKEN`

The email verification token in the URL query parameter (`?token=…`) is invalid or has expired. Tokens expire after 24 hours (configurable via `VERIFICATION_TOKEN_TTL_HOURS`).

**What to do:** Request a fresh token via `POST /v1/resend-verification`.

### `DOCUMENT_TYPE_NOT_ENABLED`

The `documentType` field in the request body specifies a document type that is not currently active for this issuer. The `detail` field lists the allowed types.

**What to do:** Enable the document type via `POST /v1/issuers/:id/document-types`, or use one of the allowed types listed in `detail`.

### `DOCUMENT_TYPE_NOT_SUPPORTED`

The document type code is not registered in the API at all (as opposed to simply being inactive for this issuer).

**What to do:** Check the supported types with `GET /v1/issuers/:id/document-types`. Only registered types can be enabled.

### `INVALID_STATE_TRANSITION`

The requested operation is not valid for the document's current status. The `detail` field names the attempted transition.

**What to do:** Check the document's current status with [Get Document](../endpoints/get-document.md) and only perform operations allowed for that status:

| Status | Allowed operations |
|---|---|
| `SIGNED` | Send to SRI |
| `RECEIVED` | Check authorization |
| `RETURNED` | Rebuild |
| `NOT_AUTHORIZED` | Rebuild |
| `AUTHORIZED` | Download RIDE, download XML, retry email |

### `DOCUMENT_NOT_AUTHORIZED`

The operation requires the document to have status `AUTHORIZED`. This applies to RIDE generation (`GET /:key/ride`) and manual email retries.

**What to do:** Complete the full document lifecycle (send → authorize) first.

### `SELF_REVOCATION_FORBIDDEN`

You cannot revoke the API key that authenticated the current request.

**What to do:** Use a different active API key to revoke this one. List your keys with `GET /v1/keys`.

### `INVALID_FILE_UPLOAD`

A file upload (e.g. a P12 certificate or issuer logo) is missing, the wrong MIME type, or exceeds the field's size limit. The `detail` field names the specific constraint that failed — for example, a logo over 500 KB on `POST /v1/register` or `PATCH /v1/issuers/:id/logo`.

**What to do:** Check the file against the limits documented on the endpoint (e.g. [Upload Issuer Logo](../endpoints/upload-issuer-logo.md)) and re-upload.

### `BAD_REQUEST` (fallback)

A generic bad request not covered by a specific code above. Read the `detail` field for the reason.

## Example response

```json
{
  "type":     "https://docs.comprobify.com/errors/bad-request",
  "title":    "Bad Request",
  "status":   400,
  "code":     "CERTIFICATE_EXPIRED",
  "detail":   "Certificate expired on 2025-03-15. Replace the P12 file on this issuer before creating documents.",
  "instance": "/v1/documents"
}
```
