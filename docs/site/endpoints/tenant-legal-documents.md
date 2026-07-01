# Tenant Legal Documents

View and accept the personalized legal document instances generated for the authenticated tenant. Each document (Terms of Service, Privacy Policy, DPA) is generated with the tenant's own business name and RUC substituted in at registration time — the stored content is an immutable snapshot of what was in effect when the account was created.

Use [Legal Acceptance Status](legal-status.md) to check whether any document needs re-acceptance. Use `POST /v1/tenants/accept-legal` (on that same page) to record acceptance.

## List documents

```
GET /v1/tenants/legal-documents
```

**Authentication:** `Authorization: Bearer <api-key>`

### Response

```json
{
  "ok": true,
  "documents": [
    {
      "id": 1,
      "documentType": "TERMS",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    },
    {
      "id": 2,
      "documentType": "PRIVACY",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    },
    {
      "id": 3,
      "documentType": "DPA",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    }
  ]
}
```

Returns all instances across all versions, newest first per type. Status is `PENDING` (generated, not yet accepted) or `ACCEPTED`. When a new template version is published, a new `PENDING` instance appears here after the first call to `GET /v1/tenants/legal-status` or this endpoint.

## Get a document (rendered HTML)

```
GET /v1/tenants/legal-documents/:type
```

**Authentication:** `Authorization: Bearer <api-key>`

**URL parameter:** `:type` must be `TERMS`, `PRIVACY`, or `DPA`.

Returns the tenant's personalized document as `text/html` — the exact content that was stored at generation time, including the tenant's own business name and RUC where applicable (particularly visible in the DPA). A disclaimer notice is prepended indicating the document has not been formally reviewed by a legal counsel.

Response headers include:
- `X-Document-Status` — `PENDING` or `ACCEPTED`
- `X-Template-Version` — the template version this instance was generated from
- `X-Accepted-At` — ISO timestamp of acceptance (only present when `ACCEPTED`)

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `:type` is not a valid document type |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Account is suspended |
| `404` | `LEGAL_DOCUMENT_NOT_FOUND` | No template has been published yet for this type |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Documents are generated at registration and lazily for any new template version when this endpoint or `GET /v1/tenants/legal-status` is called — no separate step is needed to "request" a document.
- Viewing the document does not change its status. Call `POST /v1/tenants/accept-legal` separately.
- All historical instances are preserved — accepting a new version never overwrites the old accepted record. `GET /v1/tenants/legal-documents` returns the full history per type ordered newest first.
- For admin backfill of pre-existing tenants, see `POST /v1/admin/tenants/:id/legal-documents`.
