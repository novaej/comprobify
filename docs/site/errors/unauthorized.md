# Unauthorized

**Estado HTTP:** `401 Unauthorized`

La solicitud no incluyó una API key válida, la llave fue revocada, o hay un desajuste de ambiente entre la llave y el tenant.

## Códigos

### `API_KEY_ENV_MISMATCH`

El ambiente de la API key (`sandbox` o `production`) no coincide con el ambiente actual del tenant. Por ejemplo: usar una llave de sandbox después de que el tenant se promovió a producción, o usar una llave de producción contra un tenant que sigue en modo sandbox.

**Qué hacer:** Usa una llave cuyo ambiente coincida con el del tenant. Lista tus llaves activas con `GET /v1/keys`. Las llaves de sandbox y de producción se emiten por separado — las llaves de sandbox se crean en el registro; las llaves de producción se emiten automáticamente en la promoción (`POST /v1/tenants/promote`) o se generan manualmente después.

### `UNAUTHORIZED` (respaldo)

La API key falta, está mal formada, es inválida, o ha sido revocada.

**Qué hacer:**
- Asegúrate de que el encabezado `Authorization` esté presente y formateado correctamente: `Bearer <api-key>`
- Verifica que la llave no haya sido revocada — genera una nueva vía `POST /v1/keys` si es necesario

## Ejemplos de respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/unauthorized",
  "title":    "Unauthorized",
  "status":   401,
  "code":     "API_KEY_ENV_MISMATCH",
  "detail":   "Esta API key fue creada para el ambiente sandbox. El tenant está en producción. Usa una llave creada para el ambiente correspondiente.",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/unauthorized",
  "title":    "Unauthorized",
  "status":   401,
  "code":     "UNAUTHORIZED",
  "detail":   "API key inválida o revocada",
  "instance": "/v1/documents"
}
```
