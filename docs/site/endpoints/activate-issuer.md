# Activar Emisor

Reactiva un emisor que fue previamente eliminado de forma reversible (soft-delete) mediante `DELETE /v1/issuers/:id`.

```
PATCH /v1/issuers/:id/activate
```

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor desactivado, perteneciente a tu tenant |

## Límites del plan

La reactivación vuelve a ejecutar las mismas validaciones de sucursal/punto de emisión que la creación de una sucursal nueva (`POST /v1/issuers`), de modo que desactivar y reactivar un emisor no puede usarse para exceder los límites de tu plan de suscripción:

- Si el `branchCode` del emisor no tiene ningún otro punto de emisión activo, la reactivación cuenta contra el `maxBranches` de tu plan.
- De lo contrario, cuenta contra el `maxIssuePointsPerBranch` de esa sucursal.

## Respuesta

**200 OK**

```json
{ "ok": true }
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un entero positivo |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `402` | `BRANCH_LIMIT_REACHED` | La reactivación excedería el límite de sucursales del plan del tenant |
| `402` | `ISSUE_POINT_LIMIT_REACHED` | La reactivación excedería el límite de puntos de emisión por sucursal del plan |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | El id del emisor no existe, pertenece a otro tenant, o ya está activo |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
