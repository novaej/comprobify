# Cancelar Suscripción

Programa una cancelación para el final del período de facturación actual. No se emite ningún reembolso — la suscripción sigue activa en el plan actual hasta `current_period_end`, y luego el tenant pasa a FREE y la suscripción se cierra.

```
DELETE /v1/subscriptions
```

## Autenticación

`Authorization: Bearer <api-key>`

Requiere una suscripción `ACTIVE` y una llave API de producción — los tenants en sandbox deben [promoverse primero](promote-tenant.md). Si en lugar de cancelar por completo deseas moverte a un plan **pago** inferior, usa [`POST /v1/subscriptions/change-tier`](change-tier.md).

## Cómo funciona

Llamar a este endpoint establece `pending_tier = 'FREE'` en tu suscripción activa y retorna de inmediato — **no** cancela el acceso en el momento. La suscripción continúa con normalidad hasta `current_period_end`. El job programado diario del proveedor (`POST /v1/admin/jobs/subscriptions`) aplica entonces la cancelación: tu plan baja a FREE, tu `document_quota` se reinicia a la asignación de FREE, y el estado de la suscripción pasa a `CANCELLED`.

No hay reembolso por el tiempo restante del período actual.

## Cuerpo de la solicitud

Ninguno.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tenant_id": 4,
    "tier": "STARTER",
    "billing_interval": "MONTHLY",
    "status": "ACTIVE",
    "pending_tier": "FREE",
    "current_period_start": "2026-06-15T00:00:00.000Z",
    "current_period_end": "2026-07-15T00:00:00.000Z"
  },
  "effectiveAt": "2026-07-15T00:00:00.000Z"
}
```

`effectiveAt` es el `current_period_end` en el que se aplicará la cancelación. El campo `pending_tier` de tu suscripción mostrará `"FREE"` hasta ese momento.

## Qué sucede después

No hay ninguna notificación cuando se aplica la cancelación — consulta periódicamente [`GET /v1/subscriptions/me`](get-my-subscriptions.md) para confirmar que el estado cambió a `CANCELLED`, o [`GET /v1/tenants/me`](tenant-me.md) para confirmar que tu plan y cuota bajaron a los valores de FREE.

No se emitirá ningún recordatorio de renovación para una suscripción con cancelación pendiente.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | Llave API ausente o inválida |
| `403` | `REQUIRES_PRODUCTION` | El tenant sigue en sandbox — promuévelo a producción primero |
| `409` | `NO_ACTIVE_SUBSCRIPTION` | No tienes ninguna suscripción `ACTIVE` para cancelar |
| `409` | `CANCELLATION_ALREADY_PENDING` | Ya hay una cancelación programada para esta suscripción |
| `409` | `TIER_CHANGE_ALREADY_PENDING` | Ya hay una degradación de plan pago programada, o un pago de mejora de plan ya está en curso — resuélvelo primero |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
