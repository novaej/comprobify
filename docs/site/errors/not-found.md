# Not Found

**Estado HTTP:** `404 Not Found`

El recurso solicitado no existe o no es accesible para este tenant.

## Códigos

### `ISSUER_NOT_FOUND`

El ID de emisor proporcionado en `X-Issuer-Id` o en un parámetro de URL (`/v1/issuers/:id/…`) no coincide con ningún emisor activo.

**Qué hacer:** Llama a `GET /v1/issuers` para listar los emisores de tu tenant y verificar el ID.

### `SOURCE_ISSUER_NOT_FOUND`

El campo `sourceIssuerId` en `POST /v1/issuers` (creación de sucursal) no coincide con ningún emisor que pertenezca a este tenant.

**Qué hacer:** Asegúrate de que `sourceIssuerId` sea el ID numérico de uno de los emisores existentes de tu tenant, devuelto por `GET /v1/issuers`.

### `NOT_FOUND` (respaldo)

Una respuesta genérica de no encontrado para otros recursos (comprobantes, llaves API, etc.). Lee `detail` para conocer el tipo de recurso específico.

**Qué hacer:**
- Para comprobantes — verifica que la clave de acceso tenga exactamente 49 dígitos y haya sido creada por un emisor que pertenece a este tenant
- Para llaves API — verifica el ID de la llave en la URL; lista las llaves activas con `GET /v1/keys`

## Ejemplos de respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "ISSUER_NOT_FOUND",
  "detail":   "Emisor no encontrado",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "NOT_FOUND",
  "detail":   "Comprobante no encontrado",
  "instance": "/v1/documents/0000000000000000000000000000000000000000000000000"
}
```
