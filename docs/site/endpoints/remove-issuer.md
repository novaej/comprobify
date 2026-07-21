# Eliminar Emisor

Elimina (soft-delete) un emisor (establece `active = false`). No hay eliminaciones definitivas — la fila y su historial permanecen en la base de datos.

```
DELETE /v1/issuers/:id
```

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor (de `GET /v1/issuers`) |

## Restricciones

- **No se puede eliminar el último emisor activo del tenant.** Todo tenant debe conservar al menos uno.
- **No se puede eliminar un emisor que alguna vez haya emitido un comprobante** — se verifica tanto en el esquema `production` como en el `sandbox`. Crea un nuevo emisor en lugar de reutilizar uno con historial.

## Respuesta

**200 OK**

```json
{ "ok": true }
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `LAST_ISSUER_CANNOT_BE_REMOVED` | Este es el único emisor activo restante del tenant |
| `400` | `ISSUER_HAS_DOCUMENTS` | El emisor ha emitido al menos un comprobante |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | Emisor no encontrado o ya inactivo |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
