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

### `INSUFFICIENT_SCOPE`

La API key usada en esta solicitud no tiene el scope que exige el endpoint de destino. Cada llave tiene un arreglo `scopes` (`documents:write`, `documents:read`, `issuers:read`, `issuers:write`, `keys:manage`, `billing:manage`, `webhooks:manage`, `tenant:manage`, `tenant:promote`) — ver [API keys → Scopes](/endpoints/api-keys#scopes) para el vocabulario completo y qué rutas exigen qué scope. La primera llave de un tenant (creada en el registro) siempre tiene los nueve (acceso total), pero cualquier llave creada después vía `POST /v1/keys` puede ser más reducida — ya sea por solicitud explícita, o porque clonó los scopes de una llave más reducida al omitir `scopes` (ver [Crear una nueva llave](/endpoints/api-keys#crear-una-nueva-llave)). Este error ocurre siempre que la llave que llama carezca del scope que exige la ruta, sin importar cómo haya llegado a tener ese scope reducido.

**Qué hacer:** Crea una nueva llave que incluya el scope requerido, o usa otra llave más amplia que ya tengas para esta llamada.

### `SCOPE_ESCALATION_FORBIDDEN`

Solo se devuelve desde `POST /v1/keys`. Intentaste crear una nueva llave con un scope que tu propia llave no tiene — una llave nunca puede crear una más amplia que ella misma, ni siquiera con `keys:manage`. Ver [API keys → Crear una nueva llave](/endpoints/api-keys#crear-una-nueva-llave) para la regla de contención de privilegios.

**Qué hacer:** Solicita solo scopes que tu propia llave ya tenga, u omite `scopes` por completo para clonar los scopes de tu propia llave en la nueva.

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

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "INSUFFICIENT_SCOPE",
  "detail":   "This API key does not have the 'keys:manage' scope",
  "instance": "/v1/keys"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "SCOPE_ESCALATION_FORBIDDEN",
  "detail":   "Cannot mint a key with scopes the requesting key does not itself have: tenant:promote",
  "instance": "/v1/keys"
}
```
