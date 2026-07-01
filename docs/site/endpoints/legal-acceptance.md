# Legal Acceptance Status

Check whether the authenticated tenant needs to re-accept any legal documents, and record a new acceptance when they do.

Use this on login/app-load to drive a re-acceptance modal. If `needsAcceptance` is `true`, show the updated documents listed in `outdated` and call `POST /v1/tenants/legal-acceptance` when the user confirms.

## Check status

```
GET /v1/tenants/legal-acceptance
```

**Authentication:** `Authorization: Bearer <api-key>`

### Response

#### All current — no action needed

```json
{
  "ok": true,
  "legal": {
    "needsAcceptance": false,
    "outdated": []
  }
}
```

#### One or more documents updated since last acceptance

```json
{
  "ok": true,
  "legal": {
    "needsAcceptance": true,
    "outdated": [
      {
        "documentType": "DPA",
        "currentVersion": "2026-07-01",
        "acceptedVersion": "2026-06-28",
        "url": "/v1/legal/documents/DPA"
      }
    ]
  }
}
```

Each entry in `outdated` names the specific document type that changed. Use the `url` to fetch and display the updated document before asking for re-acceptance.

| Field | Description |
|---|---|
| `needsAcceptance` | `true` if any document type has a new template version that isn't yet ACCEPTED |
| `outdated[].documentType` | `TERMS`, `PRIVACY`, or `DPA` |
| `outdated[].currentVersion` | Template version currently published |
| `outdated[].acceptedVersion` | Template version the tenant last accepted, or `null` if never accepted |
| `outdated[].status` | `PENDING` (generated, not accepted), or `NOT_GENERATED` (template published but instance not yet created) |
| `outdated[].url` | URL to the tenant's personalized document instance (`GET /v1/tenants/legal-documents/:type`) |

**Calling this endpoint automatically generates any missing `PENDING` instances** for new template versions — no separate backfill call needed after the admin publishes an update.

### Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Account is suspended |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Record acceptance

```
POST /v1/tenants/legal-acceptance
```

**Authentication:** `Authorization: Bearer <api-key>`

### Request body

```json
{ "termsVersion": "2026-07-01" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `termsVersion` | string | Yes | The version string from the current TERMS document (from `GET /v1/legal/documents`). The server validates this against what's currently published before recording anything. |

### Response

**200 OK**

```json
{ "ok": true }
```

Records one acceptance row per currently-published document type (TERMS, PRIVACY, DPA), capturing the IP address and user agent of the request alongside the version and content hash.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `termsVersion` missing or too long |
| `400` | `LEGAL_VERSION_MISMATCH` | The submitted `termsVersion` does not match the currently published TERMS version — the document was updated between when your UI loaded and when the user clicked accept. Re-fetch `GET /v1/legal/documents`, show the updated content, and ask for acceptance again. |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Account is suspended |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Changes to any one of the three documents (TERMS, PRIVACY, or DPA) independently will surface as a mismatch for that type only — the other two won't appear in `outdated` unless they also changed. This means a DPA-only update triggers re-acceptance for the DPA without forcing the tenant to "re-accept" unchanged Terms or Privacy content.
- The API key does not need `X-Issuer-Id` — this is a tenant-level operation.
