# Webhooks

Registra URLs de callback HTTPS para recibir notificaciones de eventos casi en tiempo real. Cuando la API crea o actualiza una notificación (por ejemplo, un comprobante es autorizado, un certificado está por expirar), envía inmediatamente un POST con un payload firmado a cada endpoint activo que esté suscrito a ese tipo de evento.

```
POST   /v1/webhooks
GET    /v1/webhooks
PATCH  /v1/webhooks/:id
DELETE /v1/webhooks/:id
```

## Autenticación

`Authorization: Bearer <api-key>` — cualquier llave activa del tenant.

## Límites por plan

| Plan | Máximo de endpoints activos |
|---|---|
| FREE | 1 |
| STARTER | 2 |
| GROWTH | 5 |
| BUSINESS | 10 |

---

## Objeto de endpoint de webhook

```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "url":        "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING"],
  "active":     true,
  "createdAt":  "2026-05-31T10:00:00.000Z",
  "updatedAt":  "2026-05-31T10:00:00.000Z"
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string (UUID) | Identificador estable |
| `url` | string | URL HTTPS a la que la API envía los eventos |
| `eventTypes` | string[] | Tipos de evento suscritos. Un arreglo vacío significa suscripción a **todos** los tipos de evento. |
| `active` | boolean | `false` después de darse de baja; los envíos históricos se conservan |
| `createdAt` | string | Timestamp ISO del registro |
| `updatedAt` | string | Timestamp ISO de la última actualización |

> **Nota:** el `secret` de firma nunca se devuelve después del registro inicial. Guárdalo inmediatamente al crearlo.

---

## Registrar un endpoint

```
POST /v1/webhooks
```

Crea un nuevo endpoint de webhook y devuelve el secreto de firma. **El secreto se muestra exactamente una vez** — guárdalo de inmediato.

### Cuerpo de la solicitud

```json
{
  "url":        "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED"]
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `url` | string | Sí | Debe ser una URL HTTPS válida |
| `eventTypes` | string[] | No | Tipos de evento a los que suscribirse. Omite o pasa `[]` para recibir todos los eventos. Valores válidos: `DOCUMENT_AUTHORIZED`, `CERT_EXPIRING`, `CERT_EXPIRED`, `SRI_SUBMISSION_FAILED`, `EMAIL_DELIVERY_FAILED`, `QUOTA_WARNING` |

### Respuesta

**201 Created**

```json
{
  "ok": true,
  "endpoint": {
    "id": "00000000-0000-0000-0000-000000000001",
    "url":        "https://app.example.com/v1/comprobify/events",
    "eventTypes": ["DOCUMENT_AUTHORIZED"],
    "active":     true,
    "createdAt":  "2026-05-31T10:00:00.000Z",
    "updatedAt":  "2026-05-31T10:00:00.000Z"
  },
  "secret": "a3f5c8d1e2b4..."
}
```

Guarda el `secret` de forma segura. Se usa para verificar el header `X-Comprobify-Signature` en las solicitudes de webhook entrantes.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `url` no es una URL HTTPS válida, o un `eventType` no es reconocido |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `402` | `WEBHOOK_ENDPOINT_LIMIT_REACHED` | Se alcanzó el límite del tier en endpoints activos |

---

## Listar endpoints

```
GET /v1/webhooks
```

Devuelve todos los endpoints activos del tenant (los secretos de firma nunca se incluyen).

### Respuesta

**200 OK**

```json
{
  "ok": true,
  "endpoints": [ ... ]
}
```

---

## Actualizar un endpoint

```
PATCH /v1/webhooks/:id
```

Actualiza la URL, las suscripciones de eventos, o el indicador `active` de un endpoint existente. Todos los campos son opcionales — envía solo lo que quieras cambiar.

### Cuerpo de la solicitud

```json
{
  "url":        "https://app.example.com/v1/comprobify/events-v2",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRED"],
  "active":     true
}
```

### Respuesta

**200 OK**

```json
{
  "ok": true,
  "endpoint": { ... }
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `url` inválida, `eventType` desconocido, o `active` no booleano |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `404` | `NOT_FOUND` | Endpoint no encontrado o pertenece a otro tenant |

---

## Dar de baja un endpoint

```
DELETE /v1/webhooks/:id
```

Elimina el endpoint de forma lógica (`active = false`). El endpoint deja de recibir envíos inmediatamente. Los registros de envíos pasados se conservan en `webhook_deliveries` con fines de auditoría.

### Respuesta

**200 OK**

```json
{ "ok": true }
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `404` | `NOT_FOUND` | Endpoint no encontrado o pertenece a otro tenant |

---

## Recepción de webhooks

### Formato del payload

```json
{
  "event":      "DOCUMENT_AUTHORIZED",
  "deliveryId": "00000000-0000-0000-0000-000000000017",
  "timestamp":  1748649600,
  "tenantId": "00000000-0000-0000-0000-000000000007",
  "data": {
    "id": "00000000-0000-0000-0000-000000000042",
    "type":      "DOCUMENT_AUTHORIZED",
    "severity":  "INFO",
    "title":     "Factura autorizada",
    "message":   "La factura 001-001-000000012 de ACME Corp fue autorizada por el SRI.",
    "metadata":  { ... },
    "issuerId": "00000000-0000-0000-0000-000000000003",
    "readAt":    null,
    "expiresAt": null,
    "createdAt": "2026-05-28T14:30:00.000Z"
  }
}
```

| Campo | Descripción |
|---|---|
| `event` | El tipo de notificación (refleja `data.type`) |
| `deliveryId` | ID de la fila en `webhook_deliveries`. Úsalo para deduplicación — los reintentos del mismo envío tienen el mismo `deliveryId`. |
| `timestamp` | Timestamp Unix (segundos) de cuándo se creó originalmente el evento |
| `tenantId` | Tu ID de tenant |
| `data` | [Objeto de notificación](notifications.md#notification-object) completo |

### Verificación de firmas

Cada solicitud incluye:

```
X-Comprobify-Signature: sha256=<hex>
X-Comprobify-Timestamp: <unix seconds>
```

Para verificar:

1. Lee el cuerpo crudo de la solicitud como una cadena (antes de analizarlo como JSON).
2. Calcula `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` donde `secret` es el secreto de firma de tu endpoint.
3. Compara el resultado con la porción `sha256=` de `X-Comprobify-Signature` usando una función de comparación de **tiempo constante**.
4. Rechaza la solicitud si las firmas no coinciden o si `X-Comprobify-Timestamp` tiene más de 5 minutos de antigüedad.

**Ejemplo en Node.js:**

```js
const crypto = require('crypto');

function verifyWebhook(secret, req) {
  const timestamp = req.headers['x-comprobify-timestamp'];
  const signature = req.headers['x-comprobify-signature'];
  const rawBody   = req.rawBody; // Buffer or string before JSON.parse

  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}
```

### Requisitos de la respuesta

Devuelve **cualquier estado 2xx** para confirmar la recepción. Cualquier otro estado (incluyendo 3xx) se trata como un fallo y dispara un reintento.

Procesa el evento de forma **asíncrona** — responde con `200` de inmediato y maneja el payload en un job en segundo plano para evitar timeouts.

### Deduplicación

Usa `deliveryId` para deduplicar. Un reintento del mismo envío tiene el mismo `deliveryId` pero llega en una nueva solicitud HTTP. Tu manejador debe ser **idempotente**: procesar el mismo `deliveryId` dos veces debe producir el mismo resultado.

### Calendario de reintentos

| Intento | Momento |
|---|---|
| 1 | Inmediatamente al crearse el evento |
| 2 | 30 segundos después de que falla el intento 1 |
| 3 | 2 minutos después de que falla el intento 2 |
| FAILED | Después de 3 intentos fallidos — no hay más reintentos |

Si se agotan todos los reintentos, usa `GET /v1/notifications?sinceId=<lastId>` para ponerte al día con los eventos perdidos.
