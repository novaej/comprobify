# Pause/Resume Issuing

Pauses or resumes new document creation on an issuer (issue point) without deactivating it. The issuer's history, its existing documents (RIDE, XML, email), and every read-only endpoint keep working normally while paused — only `POST /v1/documents` and `POST /:accessKey/rebuild` targeting this issuer are blocked.

```
PATCH /v1/issuers/:id/can-issue
```

This is the only way to pause an issuer that has history: `DELETE /v1/issuers/:id` (soft-delete) is refused with `ISSUER_HAS_DOCUMENTS` as soon as the issuer has issued any document, in either environment.

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Issuer UUID belonging to your tenant |

## Request body

```json
{
  "canIssue": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `canIssue` | boolean | Yes | `false` pauses new document creation; `true` resumes it. Either direction is always allowed on an active issuer — no other business rule applies. |

## Response

**200 OK**

```json
{ "ok": true, "canIssue": false }
```

## Effect

With `canIssue: false`:

- `POST /v1/documents` with `X-Issuer-Id` pointing at this issuer returns `403 ISSUER_ISSUING_PAUSED`.
- `POST /:accessKey/rebuild` on a document from this issuer also returns `403 ISSUER_ISSUING_PAUSED` — a rebuild re-signs and re-submits to SRI, the same risk as a fresh create.
- Everything else keeps working: `GET /:accessKey/ride`, `GET /:accessKey/xml`, email retries, `POST /:accessKey/send` and `GET /:accessKey/authorize` for documents already in flight, and every read endpoint for the issuer.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a valid UUID, or `canIssue` is missing or not a boolean |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `403` | `INSUFFICIENT_SCOPE` | API key does not have the `issuers:write` scope |
| `404` | `ISSUER_NOT_FOUND` | Issuer id does not exist, belongs to another tenant, or is inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
