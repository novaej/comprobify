# Consultar Eventos del Tenant

Devuelve tu registro de auditoría completo a nivel de tenant — verificación de correo, suscripción, pago y eventos del ciclo de vida de cambios de plan/intervalo de facturación — en orden cronológico (del más antiguo al más reciente).

```
GET /v1/tenants/events
```

## Autenticación

`Authorization: Bearer <api-key>`

## Cuándo llamar a este endpoint

Este es el único lugar que muestra la secuencia completa de cambios en tu suscripción a lo largo del tiempo — por ejemplo, que comenzó como una suscripción GROWTH mensual y luego cambió a STARTER anual. [Tu suscripción y cómo pagarla](../paying-your-subscription.md) y [`GET /v1/tenants/me`](tenant-me.md) solo muestran el estado *actual*; este endpoint muestra cómo se llegó a él.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "events": [
    {
      "id": "00000000-0000-0000-0000-000000000101",
      "eventType": "EMAIL_VERIFIED",
      "detail": null,
      "createdAt": "2026-06-01T10:00:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000118",
      "eventType": "SUBSCRIPTION_CREATED",
      "detail": { "subscriptionId": "00000000-0000-0000-0000-000000000012", "tier": "GROWTH", "billingInterval": "MONTHLY" },
      "createdAt": "2026-06-01T10:05:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000119",
      "eventType": "SUBSCRIPTION_ACTIVATED",
      "detail": { "subscriptionId": "00000000-0000-0000-0000-000000000012", "tier": "GROWTH" },
      "createdAt": "2026-06-01T10:20:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000205",
      "eventType": "TIER_CHANGE_REQUESTED",
      "detail": {
        "subscriptionId": "00000000-0000-0000-0000-000000000012",
        "fromTier": "GROWTH",
        "toTier": "STARTER",
        "fromBillingInterval": "MONTHLY",
        "toBillingInterval": "YEARLY",
        "totalAmount": 200,
        "effectiveAt": "2026-07-01T10:20:00.000Z"
      },
      "createdAt": "2026-06-25T09:00:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000212",
      "eventType": "TIER_CHANGE_SCHEDULED",
      "detail": {
        "subscriptionId": "00000000-0000-0000-0000-000000000012",
        "fromTier": "GROWTH",
        "toTier": "STARTER",
        "fromBillingInterval": "MONTHLY",
        "toBillingInterval": "YEARLY",
        "effectiveAt": "2026-07-01T10:20:00.000Z",
        "paymentId": "00000000-0000-0000-0000-000000000040"
      },
      "createdAt": "2026-06-27T14:10:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000230",
      "eventType": "TIER_CHANGED",
      "detail": {
        "subscriptionId": "00000000-0000-0000-0000-000000000012",
        "fromTier": "GROWTH",
        "toTier": "STARTER",
        "fromBillingInterval": "MONTHLY",
        "toBillingInterval": "YEARLY"
      },
      "createdAt": "2026-07-01T10:20:00.000Z"
    }
  ]
}
```

`detail` es un objeto de forma libre específico de cada `eventType` (o `null` para eventos sin contexto adicional) — los campos mostrados arriba coinciden con lo que cada tipo de evento lleva actualmente, pero trata los campos desconocidos como adiciones compatibles hacia adelante, no como un esquema fijo.

### Tipos de evento

| Evento | Significado |
|---|---|
| `VERIFICATION_EMAIL_SENT` / `VERIFICATION_EMAIL_FAILED` / `VERIFICATION_EMAIL_DELIVERED` / `VERIFICATION_EMAIL_TEMP_FAILED` / `VERIFICATION_EMAIL_COMPLAINED` | Estado de entrega del correo de verificación de registro |
| `EMAIL_VERIFIED` | El correo del tenant fue verificado |
| `SUBSCRIPTION_CREATED` | Se inició una suscripción (`POST /v1/subscriptions` o en la promoción) |
| `PAYMENT_REPORTED` | Se envió el comprobante de transferencia para un pago |
| `PAYMENT_VERIFIED` / `PAYMENT_REJECTED` | El proveedor revisó el comprobante de un pago. `PAYMENT_VERIFIED` es también el momento en que el plan se aplica |
| `PAYMENT_REFUNDED` | Un pago verificado fue revertido (transferencia devuelta, cargo duplicado) y su efecto se deshizo — `detail` incluye `restoredTier`, el plan al que volvió la cuenta |
| `INVOICE_LINKED` | Se vinculó una factura autofacturada a una suscripción o pago. Es únicamente registro contable: no cambia el estado de tu suscripción, que ya se aplicó al verificarse el pago |
| `SUBSCRIPTION_ACTIVATED` | La suscripción alcanzó el estado `ACTIVE` (se abrió el primer periodo de facturación), al verificarse su pago |
| `TIER_CHANGE_REQUESTED` | [Tu suscripción y cómo pagarla](../paying-your-subscription.md) creó un pago (mejora en el mismo intervalo, o cualquier cambio de intervalo de facturación) |
| `TIER_CHANGE_SCHEDULED` | Se programó un cambio de plan/intervalo para aplicarse en `current_period_end` — ya sea una degradación gratuita en el mismo intervalo (de inmediato, al momento de la solicitud) o un cambio de intervalo de facturación pagado (una vez que su pago se verifica) |
| `TIER_CHANGED` | Un cambio de plan y/o intervalo de facturación realmente tomó efecto |
| `SUBSCRIPTION_CANCELLATION_SCHEDULED` | [Tu suscripción y cómo pagarla](../paying-your-subscription.md) programó una cancelación al final del periodo |
| `SUBSCRIPTION_CANCELLED` | La suscripción alcanzó el estado `CANCELLED` (se aplicó la cancelación programada, o hubo intervención administrativa) |
| `RENEWAL_DUE` | Se abrió un pago de renovación antes de `current_period_end` |
| `SUBSCRIPTION_RENEWED` | Un pago de renovación fue verificado, extendiendo el periodo de facturación |
| `SUBSCRIPTION_EXPIRED` | La suscripción superó su periodo de gracia de renovación sin ningún pago y fue degradada a FREE |
| `STATUS_CHANGED` | El estado de la cuenta cambió — `detail` trae `from`, `to` y, al suspender, `reasonCode` (ver `suspensionReasonCode` en [`GET /v1/tenants/me`](tenant-me.md)) |
| `ACCOUNT_RECOVERED` | La cuenta se recuperó con su certificado: se revocaron las llaves del ambiente actual y la cuenta volvió a verificación de correo — `detail` trae `environment` y `previousStatus` |
| `CERTIFICATE_UPLOADED` / `CERTIFICATE_RENEWED` | Se cargó un certificado P12 nuevo para un emisor, o se renovó uno existente — `detail` trae `issuerId`, `certFingerprint` y `certExpiry` |

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `404` | `NOT_FOUND` | No se pudo resolver el tenant (normalmente no debería ocurrir en una solicitud autenticada) |
| `429` | `TOO_MANY_REQUESTS` | Límite de solicitudes excedido |

## Notas

- Devuelve un arreglo vacío si aún no ha ocurrido nada más allá del registro.
- No está paginado — se devuelve el historial completo cada vez. Es suficiente para el volumen típico de vida útil de un tenant; si en algún momento se necesita paginación, `?sinceId=` (siguiendo el patrón de [Notificaciones](notifications.md)) sería la adición natural.
