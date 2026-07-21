# Activate Issuer

Reactivates an issuer that was previously soft-deleted via `DELETE /v1/issuers/:id`.

```
PATCH /v1/issuers/:id/activate
```

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Issuer UUID of a deactivated issuer belonging to your tenant |

## Plan limits

Reactivation re-runs the same branch/issue-point checks as creating a new branch (`POST /v1/issuers`), so deactivating and reactivating an issuer cannot be used to exceed your subscription tier's limits:

- If the issuer's `branchCode` has no other active issue point, reactivating counts against your tier's `maxBranches`.
- Otherwise it counts against that branch's `maxIssuePointsPerBranch`.

## Response

**200 OK**

```json
{ "ok": true }
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a positive integer |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `402` | `BRANCH_LIMIT_REACHED` | Reactivating would exceed the tenant's plan branch limit |
| `402` | `ISSUE_POINT_LIMIT_REACHED` | Reactivating would exceed the plan's issue-points-per-branch limit |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer id does not exist, belongs to another tenant, or is already active |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
