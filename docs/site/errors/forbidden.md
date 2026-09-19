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

### `INTERNAL_SERVICE_ONLY`

La solicitud llegó a una acción reservada a la aplicación web de Comprobify: crear la cuenta, verificar el correo, recuperarla, aceptar los acuerdos legales, pasar a producción, o gestionar la suscripción y los pagos. La API no ofrece una forma directa de hacerlo.

**Qué hacer:** Realiza esa acción desde la aplicación web. No hay nada que configurar en tu integración — ver [Tu cuenta y la aplicación web](../account-lifecycle.md#si-ves-internal-service-only).

### `EMAIL_VERIFICATION_REQUIRED`

La operación requiere que se haya completado la verificación de correo. Esto bloquea:
- Crear sucursales adicionales (`POST /v1/issuers`)
- Promover a producción
- Generar nuevas API keys (`POST /v1/keys`)

**Qué hacer:** Revisa la bandeja de entrada en busca del correo de verificación original, o pide uno nuevo desde la aplicación web de Comprobify (el reenvío solo se hace desde ella — ver [Tu cuenta y la aplicación web](../account-lifecycle.md#verificar-tu-correo)). Luego reintenta la operación original.

### `PRODUCTION_KEY_REQUIRES_PROMOTION`

Una API key de producción solo puede crearse si el tenant ya se ha promovido a producción al menos una vez. Antes de la promoción, solo se pueden generar llaves de sandbox.

**Qué hacer:** Promueve tu cuenta a producción desde la aplicación web de Comprobify (la promoción solo se hace desde ella — ver [Tu cuenta y la aplicación web](../account-lifecycle.md#pasar-a-produccion)). Las llaves de producción se emiten automáticamente como parte de la promoción, y se pueden generar llaves adicionales después vía `POST /v1/keys`.

### `INSUFFICIENT_SCOPE`

La API key usada en esta solicitud no tiene el scope que exige el endpoint de destino. Cada llave tiene un arreglo `scopes` (`documents:write`, `documents:read`, `issuers:read`, `issuers:write`, `keys:manage`, `billing:manage`, `webhooks:manage`, `tenant:manage`, `tenant:promote`) — ver [API keys → Scopes](/endpoints/api-keys#scopes) para el vocabulario completo y qué rutas exigen qué scope. La primera llave de un tenant (creada en el registro) siempre tiene los nueve (acceso total), pero cualquier llave creada después vía `POST /v1/keys` puede ser más reducida — ya sea por solicitud explícita, o porque clonó los scopes de una llave más reducida al omitir `scopes` (ver [Crear una nueva llave](/endpoints/api-keys#crear-una-nueva-llave)). Este error ocurre siempre que la llave que llama carezca del scope que exige la ruta, sin importar cómo haya llegado a tener ese scope reducido.

**Qué hacer:** Crea una nueva llave que incluya el scope requerido, o usa otra llave más amplia que ya tengas para esta llamada.

### `SCOPE_ESCALATION_FORBIDDEN`

Solo se devuelve desde `POST /v1/keys`. Intentaste crear una nueva llave con un scope que tu propia llave no tiene — una llave nunca puede crear una más amplia que ella misma, ni siquiera con `keys:manage`. Ver [API keys → Crear una nueva llave](/endpoints/api-keys#crear-una-nueva-llave) para la regla de contención de privilegios.

**Qué hacer:** Solicita solo scopes que tu propia llave ya tenga, u omite `scopes` por completo para clonar los scopes de tu propia llave en la nueva.

### `ISSUER_ISSUING_PAUSED`

El emisor está activo pero fue pausado para no crear comprobantes nuevos vía `PATCH /v1/issuers/:id/can-issue`. Aplica tanto a `POST /v1/documents` como a `POST /:accessKey/rebuild` (una reconstrucción vuelve a firmar y reenviar al SRI, el mismo riesgo que una creación nueva). Los comprobantes ya emitidos por este emisor no se ven afectados — RIDE, XML, y otros endpoints de solo lectura siguen funcionando con normalidad.

**Qué hacer:** Reanuda la emisión llamando `PATCH /v1/issuers/:id/can-issue` con `{ "canIssue": true }`, o usa un emisor distinto.

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

```json
{
  "type":     "https://docs.comprobify.com/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "ISSUER_ISSUING_PAUSED",
  "detail":   "This issue point is not currently allowed to create new documents",
  "instance": "/v1/documents"
}
```
