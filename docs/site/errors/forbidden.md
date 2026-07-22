# Forbidden

**Estado HTTP:** `403 Forbidden`

La API key es válida y el recurso existe, pero no tienes permiso para realizar esta operación. Cada error 403 lleva un `code` específico — úsalo para manejar cada caso de forma programática.

## Códigos

### `ISSUER_FORBIDDEN`

El encabezado `X-Issuer-Id` nombra un emisor que existe pero pertenece a otro tenant. Cada tenant solo puede operar sobre sus propios emisores.

**Qué hacer:** Llama a `GET /v1/issuers` con la misma API key para listar los emisores de tu tenant, luego reenvía la solicitud con un `X-Issuer-Id` válido.

### `ACCOUNT_SUSPENDED`

La cuenta del tenant ha sido suspendida. Toda solicitud de escritura falla hasta que se levante la suspensión, y lo mismo ocurre con `GET /:accessKey/authorize` (hace una llamada en vivo al SRI y puede enviar un correo). Un conjunto seleccionado de otros endpoints de solo lectura permanece disponible para que aún puedas ver tus datos existentes: listar/descargar tus propios comprobantes (incluyendo RIDE y XML), tu historial de suscripción y comprobantes de pago, y tu estado de cuenta/acuerdos/bitácora de eventos.

**Qué hacer:** Contacta a soporte. Las cuentas suspendidas no pueden recuperarse por sí solas, pero puedes seguir revisando lo que ya está en tu cuenta mientras se resuelve el problema.

### `EMAIL_VERIFICATION_REQUIRED`

La operación requiere que se haya completado la verificación de correo. Esto bloquea:
- Crear sucursales adicionales (`POST /v1/issuers`)
- Promover a producción (`POST /v1/tenants/promote`)
- Generar nuevas API keys (`POST /v1/keys`)

**Qué hacer:** Revisa la bandeja de entrada en busca del correo de verificación original, o solicita uno nuevo vía `POST /v1/resend-verification`. Luego reintenta la operación original.

### `PRODUCTION_KEY_REQUIRES_PROMOTION`

Una API key de producción solo puede crearse si el tenant ya se ha promovido a producción al menos una vez. Antes de la promoción, solo se pueden generar llaves de sandbox.

**Qué hacer:** Llama a `POST /v1/tenants/promote` para promover el tenant a producción. Las llaves de producción se emitirán automáticamente como parte de esa respuesta. Se pueden generar llaves de producción adicionales después vía `POST /v1/keys`.

### `FORBIDDEN` (respaldo)

Un 403 genérico no cubierto por un código específico de los anteriores. Lee `detail`.

## Ejemplos de respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "ISSUER_FORBIDDEN",
  "detail":   "El emisor no pertenece a este tenant",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "EMAIL_VERIFICATION_REQUIRED",
  "detail":   "Se requiere verificación de correo antes de crear sucursales adicionales. Revisa tu bandeja de entrada.",
  "instance": "/v1/issuers"
}
```
