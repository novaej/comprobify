# Formato de Errores

Todas las respuestas de error usan [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807) con `Content-Type: application/problem+json`.

## Estructura de la respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/validation-error",
  "title":    "Validation Failed",
  "status":   400,
  "code":     "VALIDATION_FAILED",
  "detail":   "La validación falló",
  "instance": "/v1/documents"
}
```

| Campo | Descripción |
|---|---|
| `type` | URL que enlaza a la página de documentación de este tipo de error (este sitio) |
| `title` | Descripción corta y estable del tipo de error |
| `status` | Código de estado HTTP (igual al estado de la respuesta) |
| `code` | Clave estable legible por máquina — úsala para i18n y manejo programático |
| `detail` | Explicación legible por humanos de esta ocurrencia específica |
| `instance` | La ruta de la solicitud que produjo el error |

## Usar `code` para el manejo programático

El campo `code` es la clave estable sobre la que tu aplicación cliente debería decidir. Nunca cambia para una situación dada, sin importar los cambios en el texto legible de `detail`.

```js
switch (error.code) {
  case 'CERTIFICATE_EXPIRED':
    return 'Tu certificado de firma ha expirado. Reemplázalo en la configuración del emisor.';
  case 'RESEND_COOLDOWN':
    return 'Por favor espera antes de solicitar otro correo.';
  case 'QUOTA_EXCEEDED':
    return 'Se alcanzó el límite mensual de comprobantes. Mejora tu plan.';
  default:
    return error.detail;
}
```

## Errores de validación

Cuando `code` es `VALIDATION_FAILED`, un arreglo adicional `errors` lista cada campo que falló:

```json
{
  "type":   "https://docs.comprobify.com/errors/validation-error",
  "title":  "Validation Failed",
  "status": 400,
  "code":   "VALIDATION_FAILED",
  "detail": "La validación falló",
  "instance": "/v1/documents",
  "errors": [
    {
      "field":   "buyer.email",
      "message": "El correo del comprador es requerido y debe ser una dirección de correo válida",
      "code":    "buyer.email",
      "value":   ""
    }
  ]
}
```

Cada entrada en `errors` tiene:

| Campo | Descripción |
|---|---|
| `field` | La ruta del cuerpo de la solicitud que falló (p. ej. `buyer.email`, `items[0].taxes[0].code`) |
| `message` | Descripción en inglés del fallo |
| `code` | Ruta del campo sin los índices de arreglo — clave estable para localización a nivel de campo (p. ej. `items.taxes.code`) |
| `value` | El valor que fue enviado |

## Errores del SRI

`POST /:accessKey/send` y `GET /:accessKey/authorize` son asíncronos (ver [Enviar al SRI](/endpoints/send-to-sri)) — `SRI_SUBMISSION_FAILED` ya no puede devolverse como respuesta HTTP desde ninguno de los dos endpoints. Un fallo de red ahora ocurre dentro del worker en segundo plano y se registra como un evento de comprobante `ERROR` en su lugar; ver [Envío al SRI Fallido](/errors/sri-error) para más detalles. La estructura de abajo se mantiene como referencia:

Cuando `code` es `SRI_SUBMISSION_FAILED`, un arreglo adicional `sriMessages` contiene los mensajes en bruto devueltos por el servicio SOAP del SRI:

```json
{
  "type":   "https://docs.comprobify.com/errors/sri-error",
  "title":  "SRI Submission Failed",
  "status": 502,
  "code":   "SRI_SUBMISSION_FAILED",
  "detail": "El SRI rechazó el comprobante",
  "instance": "/v1/documents/1503.../send",
  "sriMessages": [
    {
      "identifier": "35",
      "message":    "ARCHIVO NO CUMPLE ESTRUCTURA XML",
      "type":       "ERROR"
    }
  ]
}
```

## Todos los códigos de error

La mayoría de los errores llevan un `code` específico que es más preciso que solo el estado HTTP. Decide sobre `code`, no sobre `status`, para manejar los errores de forma programática.

### 400 Bad Request

| Código | Cuándo ocurre |
|---|---|
| `VALIDATION_FAILED` | Uno o más campos de la solicitud fallaron la validación — ver `errors[]` |
| `CERTIFICATE_INVALID` | El archivo P12 está corrupto o no es un archivo PKCS#12 válido |
| `CERTIFICATE_PASSWORD_INVALID` | La contraseña del P12 es incorrecta |
| `CERTIFICATE_KEY_NOT_FOUND` | No se encontró el bag de la llave de firma dentro del P12 |
| `CERTIFICATE_EXPIRED` | La fecha `notAfter` del certificado ya pasó |
| `ISSUER_ID_REQUIRED` | Falta el encabezado `X-Issuer-Id` en un endpoint de comprobantes |
| `ISSUER_ID_INVALID` | `X-Issuer-Id` no es un entero positivo válido |
| `INVALID_OR_EXPIRED_TOKEN` | El token de verificación de correo es inválido o ha expirado |
| `DOCUMENT_TYPE_NOT_ENABLED` | El tipo de comprobante solicitado no está activo para este emisor |
| `DOCUMENT_TYPE_NOT_SUPPORTED` | El código de tipo de comprobante no está registrado en el sistema |
| `INVALID_STATE_TRANSITION` | La operación del comprobante no es válida para su estado actual |
| `DOCUMENT_NOT_AUTHORIZED` | La operación (RIDE, correo) requiere que el comprobante tenga estado `AUTHORIZED` |
| `SELF_REVOCATION_FORBIDDEN` | No se puede revocar la API key usada para autenticar esta solicitud |
| `INVALID_FILE_UPLOAD` | El archivo subido falta, es del tipo incorrecto, o excede el límite de tamaño del campo (p. ej. un logo de más de 500 KB) |
| `PROOF_FILE_LIMIT_REACHED` | El pago ya tiene el número máximo de archivos de comprobante activos (10) — elimina uno antes de subir más |
| `VERSION_MISMATCH` | `termsVersion` en `POST /v1/register` o `POST /v1/tenants/agreements` no coincide con la versión actualmente publicada del documento TERMS — vuelve a consultar `GET /v1/agreements` y presenta la versión actual antes de pedirle al usuario que acepte de nuevo |
| `LAST_ISSUER_CANNOT_BE_REMOVED` | El tenant tiene solo un emisor activo restante — no se puede eliminar |
| `ISSUER_HAS_DOCUMENTS` | El emisor tiene comprobantes emitidos (en cualquiera de los dos ambientes) y no se puede eliminar |
| `SEQUENTIAL_CANNOT_DECREASE` | `nextSequential` no es mayor que el valor actual del contador |
| `TIER_CHANGE_NO_OP` | El tier y el intervalo de facturación solicitados en Change Tier coinciden con los valores actuales de la suscripción |
| `INVALID_BILLING_INTERVAL` | `billingInterval` en Create Subscription o Change Tier no es `MONTHLY` ni `YEARLY` |
| `BAD_REQUEST` | Otra solicitud mal formada (respaldo — lee `detail`) |

### 401 Unauthorized

| Código | Cuándo ocurre |
|---|---|
| `API_KEY_ENV_MISMATCH` | El ambiente de la API key (`sandbox`/`production`) no coincide con el ambiente actual del tenant |
| `UNAUTHORIZED` | API key faltante, inválida o revocada (respaldo) |

### 402 Payment Required

| Código | Cuándo ocurre |
|---|---|
| `QUOTA_EXCEEDED` | Se alcanzó la cuota mensual de comprobantes — mejora de plan |
| `BRANCH_LIMIT_REACHED` | El tenant alcanzó el número máximo de sucursales para su plan |
| `ISSUE_POINT_LIMIT_REACHED` | La sucursal alcanzó el número máximo de puntos de emisión para este plan |
| `WEBHOOK_ENDPOINT_LIMIT_REACHED` | El tenant alcanzó el número máximo de endpoints de webhook para su plan |
| `DOCUMENT_TYPE_NOT_IN_TIER` | El tipo de comprobante no está incluido en el plan actual del tenant — mejora de plan para habilitarlo |

### 403 Forbidden

| Código | Cuándo ocurre |
|---|---|
| `ISSUER_FORBIDDEN` | `X-Issuer-Id` nombra un emisor que pertenece a otro tenant |
| `ACCOUNT_SUSPENDED` | La cuenta del tenant está suspendida — contacta a soporte |
| `EMAIL_VERIFICATION_REQUIRED` | La operación requiere que la dirección de correo esté verificada |
| `AGREEMENT_ACCEPTANCE_REQUIRED` | Promoción bloqueada — uno o más acuerdos siguen en estado `PENDING` (revisa `GET /v1/tenants/agreements`, visualízalos en `GET /v1/tenants/agreements/:type`, acéptalos vía `POST /v1/tenants/agreements`) |
| `PRODUCTION_KEY_REQUIRES_PROMOTION` | No se puede crear una API key de producción antes de promover a producción |
| `FORBIDDEN` | Otro fallo de permisos (respaldo — lee `detail`) |

### 404 Not Found

| Código | Cuándo ocurre |
|---|---|
| `ISSUER_NOT_FOUND` | El ID de emisor en `X-Issuer-Id` o parámetro de URL no existe |
| `SOURCE_ISSUER_NOT_FOUND` | `sourceIssuerId` no se encontró o pertenece a otro tenant |
| `WEBHOOK_ENDPOINT_NOT_FOUND` | El endpoint de webhook no se encontró o pertenece a otro tenant |
| `SUBSCRIPTION_NOT_FOUND` | Suscripción no encontrada |
| `PAYMENT_NOT_FOUND` | Pago no encontrado, o pertenece a otro tenant |
| `AGREEMENT_NOT_FOUND` | Todavía no se ha publicado ningún documento del tipo solicitado (TERMS, PRIVACY o DPA) |
| `NOT_FOUND` | Otro recurso no encontrado (comprobante, API key — lee `detail`) |

### 409 Conflict

| Código | Cuándo ocurre |
|---|---|
| `ALREADY_VERIFIED` | Se intentó reenviar la verificación a una cuenta ya verificada |
| `SUBSCRIPTION_ALREADY_IN_FLIGHT` | El tenant ya tiene una suscripción en curso (promoción con `tier`, o Create Subscription del admin) |
| `NO_ACTIVE_SUBSCRIPTION` | Se solicitó Cancel o Change Tier pero el tenant no tiene una suscripción `ACTIVE` |
| `TIER_CHANGE_ALREADY_PENDING` | Ya hay un cambio de tier/intervalo de facturación programado, o su pago ya está en curso, para esta suscripción |
| `CANCELLATION_ALREADY_PENDING` | Ya hay una cancelación (`DELETE /v1/subscriptions`) programada para esta suscripción |
| `CONFLICT` | Se reutilizó una llave de idempotencia con un payload distinto, el pago ya fue decidido, u otro conflicto |

### 429 Too Many Requests

| Código | Cuándo ocurre |
|---|---|
| `RESEND_COOLDOWN` | Se solicitó reenviar la verificación de nuevo antes de que transcurriera el período de espera de 60 segundos |
| `TOO_MANY_REQUESTS` | Se excedió el límite de tasa de la API key |

### 500 / 502

| Código | Cuándo ocurre |
|---|---|
| `SRI_SUBMISSION_FAILED` | El servicio SOAP del SRI devolvió un error o un estado HTTP inesperado — ya no se expone a través de ninguna respuesta HTTP (ver [Errores del SRI](#errores-del-sri) arriba); ahora se registra como un evento de comprobante `ERROR` |
| `INTERNAL_ERROR` | Error inesperado del servidor |
