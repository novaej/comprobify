# Notificaciones

Alertas a nivel de tenant que se muestran a los usuarios del sistema. La API produce dos categorías de notificaciones:

- **Basadas en eventos** — creadas automáticamente cuando ocurre algo (por ejemplo, un comprobante es autorizado por el SRI).
- **Programadas** — creadas o actualizadas por el propio job en segundo plano de la API (por ejemplo, vencimiento de certificado). No requieren acción del consumidor.

```
GET   /v1/notifications
POST  /v1/notifications/:id/read
GET   /v1/notifications/preferences
PATCH /v1/notifications/preferences
```

Consulta [Webhooks](webhooks.md) para registrar URLs de callback que reciban notificaciones casi en tiempo real. Consultar este endpoint con `?sinceId=` es el mecanismo de respaldo para consumidores que no pueden exponer una URL de callback HTTPS pública.

## Autenticación

`Authorization: Bearer <api-key>` — cualquier llave activa del tenant. No se requiere `X-Issuer-Id` por defecto; proporciónalo para acotar los resultados a un emisor específico (ver [Filtro por emisor](#filtro-por-emisor)).

---

## Objeto de notificación

Todas las respuestas de listado y de notificación individual usan la misma estructura:

```json
{
  "id":        42,
  "type":      "DOCUMENT_AUTHORIZED",
  "severity":  "INFO",
  "title":     "Factura autorizada",
  "message":   "La factura 001-001-000000012 de ACME Corp fue autorizada por el SRI.",
  "metadata":  { "accessKey": "...", "sequential": "001-001-000000012", "total": "118.00" },
  "issuerId":  3,
  "readAt":    null,
  "expiresAt": null,
  "createdAt": "2026-05-28T14:30:00.000Z"
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | integer | Identificador estable. Úsalo para eliminar duplicados entre consultas y rastrear el estado de lectura por usuario. |
| `type` | string | Código de tipo legible por máquina — ver [Tipos de notificación](#tipos-de-notificación). |
| `severity` | string | `INFO` · `WARNING` · `ERROR` |
| `title` | string | Encabezado breve y legible para humanos. |
| `message` | string | Descripción completa y legible para humanos. |
| `metadata` | object\|null | Datos estructurados específicos del tipo (ver [Tipos de notificación](#tipos-de-notificación)). |
| `issuerId` | integer\|null | El emisor al que concierne esta notificación, o `null` para alertas a nivel de tenant. |
| `readAt` | string\|null | Marca de tiempo ISO de cuando la notificación fue marcada como leída, o `null` si sigue sin leer. |
| `expiresAt` | string\|null | Marca de tiempo ISO después de la cual la notificación debería ocultarse, o `null` si nunca expira. |
| `createdAt` | string | Marca de tiempo ISO de creación. |

---

## Tipos de notificación

### `DOCUMENT_AUTHORIZED`

Creada automáticamente (fire-and-forget) dentro de `GET /:accessKey/authorize` cuando el SRI confirma la autorización. Varias autorizaciones dentro de una ventana de 60 segundos se **agregan en una sola fila** para evitar saturar la lista durante el procesamiento por lotes. La misma notificación `id` puede tener un `count` actualizado en consultas sucesivas dentro de esa ventana — el frontend debería actualizar (upsert) por `id` en lugar de agregar (append).

Se dispara un payload de webhook por cada actualización de la fila agregada (incluyendo los incrementos de `count`).

**Severidad:** `INFO`

**Metadata:**

```json
{
  "documents": [
    {
      "accessKey": "...",
      "sequential": "001-001-000000012",
      "buyerName": "ACME Corp",
      "buyerId": "0901234567001",
      "total": "118.00",
      "issueDate": "2026-05-28",
      "authorizationNumber": "2605202615..."
    }
  ],
  "count": 5
}
```

`documents` se limita a 50 entradas cuando un lote es grande; `count` siempre refleja el total real.

---

### `CERT_EXPIRING`

Creada o actualizada por el job programado de la API cuando el certificado de un emisor está a menos de 30 días de su fecha `notAfter`. Como máximo **una fila no leída por emisor** — la misma fila se actualiza en su lugar en ejecuciones sucesivas del job (los días restantes se actualizan, la severidad puede escalar). Se descarta automáticamente cuando el certificado se renueva y le quedan más de 30 días.

**Severidad:** `WARNING` (> 7 días) · `ERROR` (≤ 7 días)

**Metadata:**

```json
{
  "issuerId": 3,
  "certExpiry": "2026-06-15T00:00:00.000Z",
  "daysRemaining": 18,
  "branchCode": "001",
  "issuePointCode": "001"
}
```

---

### `CERT_EXPIRED`

Mismas condiciones que `CERT_EXPIRING` pero para un certificado cuya fecha `notAfter` ya pasó.

**Severidad:** `ERROR`  
**Metadata:** misma estructura que `CERT_EXPIRING`, con `daysRemaining: 0`.

---

### `PAYMENT_VERIFIED`

Creada automáticamente (fire-and-forget) cuando tu proveedor verifica un comprobante de pago que subiste — cubre de forma uniforme una suscripción inicial, una mejora de plan y una renovación; solo cambia el texto. Se envía un correo equivalente al mismo tiempo.

**Severidad:** `INFO`

**Metadata:**

```json
{
  "paymentId": 18,
  "subscriptionId": 12,
  "tier": "STARTER",
  "billingInterval": "MONTHLY",
  "purpose": "INITIAL",
  "amount": "20.00",
  "rejectionReasonCode": null
}
```

`purpose` es `INITIAL`, `TIER_CHANGE`, o `RENEWAL`. Para un pago `TIER_CHANGE`, `tier`/`billingInterval` son el plan **objetivo** que se está comprando, no el actual de la suscripción — por ejemplo, en un pago por un cambio de STARTER mensual a GROWTH anual, esto muestra `"tier": "GROWTH"`, `"billingInterval": "YEARLY"`. `amount` es el total completo con IVA incluido (lo que realmente se transfiere vía SPI), no la base imponible antes de IVA.

---

### `PAYMENT_REJECTED`

Mismo disparador que `PAYMENT_VERIFIED`, pero para una decisión de rechazo.

**Severidad:** `WARNING`

**Metadata:** misma estructura que `PAYMENT_VERIFIED`, con `rejectionReasonCode` poblado (uno de `AMOUNT_MISMATCH`, `TRANSFER_NOT_FOUND`, `WRONG_ACCOUNT`, `ILLEGIBLE_PROOF`, `DUPLICATE_SUBMISSION`, `OTHER`) — reenvía el comprobante para el mismo `paymentId` vía [Submit Payment Proof](submit-payment-proof.md).

---

### `SUBSCRIPTION_RENEWAL_DUE`

Creada automáticamente por el job programado del proveedor unos 7 días antes del `current_period_end` de tu suscripción. Ya hay un nuevo pago `RENEWAL` abierto en el momento en que se dispara esto — envía el comprobante vía [Submit Payment Proof](submit-payment-proof.md) usando el `paymentId` de la metadata. Un correo equivalente incluye las instrucciones de transferencia bancaria.

**Severidad:** `WARNING`

**Metadata:**

```json
{
  "subscriptionId": 12,
  "paymentId": 25,
  "tier": "STARTER",
  "amount": "17.39",
  "ivaAmount": "2.61",
  "totalAmount": "20.00",
  "currentPeriodEnd": "2026-07-15T00:00:00.000Z"
}
```

---

### `SUBSCRIPTION_EXPIRED`

Creada automáticamente por el mismo job programado cuando una suscripción pasa unos 7 días de `current_period_end` sin que se verifique ninguna renovación. Para cuando esto se dispara, el tenant ya fue movido al plan FREE. Un correo equivalente explica lo ocurrido — inicia una nueva suscripción en cualquier momento vía [Create Subscription](create-subscription.md).

**Severidad:** `ERROR`

**Metadata:**

```json
{
  "subscriptionId": 12,
  "previousTier": "STARTER"
}
```

---

### Tipos reservados

Los siguientes tipos están definidos en el esquema y son aceptados por el endpoint de preferencias, pero aún no son producidos por la API. Están reservados para implementación futura:

| Tipo | Descripción |
|---|---|
| `SRI_SUBMISSION_FAILED` | El SRI rechazó permanentemente el envío de un comprobante |
| `EMAIL_DELIVERY_FAILED` | Mailgun reportó un fallo de entrega permanente |
| `QUOTA_WARNING` | El tenant se está acercando a su cuota de comprobantes |

---

## Listar notificaciones

```
GET /v1/notifications
```

Devuelve las notificaciones activas (no expiradas) del tenant, de la más reciente a la más antigua. Se incluyen tanto las leídas como las no leídas. Usa `readAt` para decidir qué mostrar como nuevo.

### Parámetros de consulta

| Parámetro | Tipo | Descripción |
|---|---|---|
| `sinceId` | integer | Opcional. Cuando se proporciona, devuelve solo las notificaciones con `id > sinceId`. Úsalo para consultas de actualización incremental eficientes: guarda el `id` más alto visto en cada consulta y pásalo en la siguiente solicitud. |

### Filtro por emisor

Proporciona `X-Issuer-Id: <id>` para restringir los resultados a un emisor específico. Cuando el encabezado está presente, la respuesta incluye:

- Notificaciones cuyo `issuerId` coincide con el valor proporcionado.
- Notificaciones a nivel de tenant (`issuerId: null`), como futuras alertas de cuota.

Omite el encabezado para recibir todas las notificaciones de todos los emisores (útil para páginas de administración o resumen).

### Respuesta

**200 OK**

```json
{
  "notifications": [ ... ],
  "unreadCount": 3
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `ISSUER_ID_INVALID` | El encabezado `X-Issuer-Id` está presente pero no es un entero positivo válido |
| `400` | `ISSUER_ID_INVALID` | `sinceId` está presente pero no es un entero positivo válido |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |

---

## Marcar como leída

```
POST /v1/notifications/:id/read
```

Marca una sola notificación como leída (`readAt` se establece al momento actual). La notificación queda excluida de `unreadCount` en todas las consultas posteriores.

**Cuándo llamarlo:** el frontend gestiona el estado de lectura por usuario en su propia base de datos. Llama a este endpoint solo cuando **todos los usuarios** con acceso a la notificación la hayan marcado como leída de su lado. Después de esta llamada, la notificación se considera leída globalmente y ya no aparecerá en `unreadCount`.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | Id numérico de la notificación |

### Respuesta

**200 OK**

```json
{
  "notification": { ... }
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un entero positivo |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `404` | `NOT_FOUND` | La notificación no existe, pertenece a otro tenant, o ya está leída |

---

## Obtener preferencias

```
GET /v1/notifications/preferences
```

Devuelve la preferencia de notificación para cada tipo. Los tipos que el tenant nunca ha configurado explícitamente tienen por defecto `enabled: true` (modelo de exclusión voluntaria).

### Respuesta

**200 OK**

```json
{
  "preferences": [
    { "type": "DOCUMENT_AUTHORIZED",      "enabled": true  },
    { "type": "CERT_EXPIRING",            "enabled": true  },
    { "type": "CERT_EXPIRED",             "enabled": true  },
    { "type": "SRI_SUBMISSION_FAILED",    "enabled": true  },
    { "type": "EMAIL_DELIVERY_FAILED",    "enabled": true  },
    { "type": "QUOTA_WARNING",            "enabled": true  },
    { "type": "PAYMENT_VERIFIED",         "enabled": true  },
    { "type": "PAYMENT_REJECTED",         "enabled": true  },
    { "type": "SUBSCRIPTION_RENEWAL_DUE", "enabled": true  },
    { "type": "SUBSCRIPTION_EXPIRED",     "enabled": true  }
  ]
}
```

---

## Actualizar preferencias

```
PATCH /v1/notifications/preferences
```

Actualiza en lote (upsert) una o más preferencias. Envía solo los tipos que quieres cambiar; los tipos no mencionados permanecen sin cambios.

### Cuerpo de la solicitud

Un arreglo de objetos de preferencia:

```json
[
  { "type": "DOCUMENT_AUTHORIZED", "enabled": false }
]
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | string | Sí | Uno de los tipos de notificación válidos |
| `enabled` | boolean | Sí | `true` para habilitar, `false` para suprimir |

Cuando `enabled` es `false` para un tipo, la API no creará nuevas notificaciones de ese tipo para el tenant. Las notificaciones no leídas existentes de ese tipo permanecen en la tabla y aún pueden marcarse como leídas.

### Respuesta

**200 OK** — misma estructura que `GET /v1/notifications/preferences`, reflejando el estado completo actualizado.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | El cuerpo no es un arreglo, o una entrada tiene un `type` inválido o un `enabled` que no es booleano |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |

---

## Patrón de integración recomendado

```
┌─────────────────────────────────────────────────────────────────────┐
│  Backend del consumidor (por ejemplo, Next.js)                      │
│                                                                     │
│  Principal (casi en tiempo real):                                   │
│    Registra un endpoint de webhook → recibe eventos vía POST        │
│    Verifica X-Comprobify-Signature en cada solicitud entrante       │
│                                                                     │
│  Respaldo / actualización incremental:                              │
│    Consulta GET /v1/notifications?sinceId=<lastSeenId> cada 60–300s │
│    Guarda el id más alto visto → pásalo como sinceId en la próxima  │
│    consulta                                                         │
│                                                                     │
│  Cuando el usuario abre el panel de notificaciones:                 │
│    Marca como leída en la BD del frontend por usuario               │
│    Cuando todos los usuarios la han leído → POST                    │
│    /v1/notifications/:id/read                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Elegir un intervalo de consulta

El tipo de notificación `DOCUMENT_AUTHORIZED` agrega varias autorizaciones que ocurren dentro de una **ventana de 60 segundos** en una sola fila. Consultar con más frecuencia que cada 60 segundos capturaría la fila a mitad de la agregación — de todos modos se actualizará de nuevo dentro de la misma ventana, así que no hay beneficio en consultar más rápido que eso.

| Escenario | Intervalo recomendado |
|---|---|
| Webhooks configurados (la consulta es solo respaldo) | 300 s (5 min) — cualquier evento perdido se recupera en el siguiente ciclo |
| Sin webhooks, la consulta es el único mecanismo de entrega | 60 s — coincide con la ventana de agregación; ir más abajo no da ningún beneficio |

No consultes por debajo de 60 segundos — no hará que los datos nuevos aparezcan antes y añade carga innecesaria.
