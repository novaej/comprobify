# Cambiar de Plan (Mejora/Degradación)

Cambia el plan y/o el intervalo de facturación de tu suscripción `ACTIVE` existente.

```
POST /v1/subscriptions/change-tier
```

## Autenticación

`Authorization: Bearer <api-key>`

Requiere que ya exista una suscripción `ACTIVE` — promociona primero con un plan pago (consulta [Promover Tenant](promote-tenant.md)) y completa esa revisión de pago inicial antes de cambiar de plan. Para cancelar por completo y volver a FREE, usa [`DELETE /v1/subscriptions`](cancel-subscription.md) en su lugar.

## Cuándo llamar a esto

Aún no existe una pasarela de pago, así que esto se apoya en el mismo flujo manual de carga y revisión de comprobante que la suscripción inicial, en lugar de cobrar algo automáticamente. Cuál de estos tres comportamientos obtienes depende de si cambia el plan, el intervalo de facturación, o ambos:

- **Mejora en el mismo intervalo** (el precio del plan de destino es mayor que el actual, `billingInterval` se omite o no cambia) se aplica de inmediato, condicionada al pago. La diferencia de precio se prorratea según la fracción restante de tu período de facturación actual — por ejemplo, mejorar exactamente a la mitad de un ciclo mensual cobra aproximadamente la mitad de la diferencia de precio. La respuesta incluye un `payment` e instrucciones de `bankTransfer`, igual que la suscripción inicial; sube el comprobante mediante [`PATCH /v1/payments/:id/proof`](submit-payment-proof.md) (el mismo endpoint, sin un flujo de carga nuevo). Tu proveedor lo revisa y vincula la factura autofacturada de la misma forma que la activación inicial — una vez que el SRI autoriza esa factura, tu plan cambia de inmediato y conservas el resto del período de facturación actual en el nuevo plan (no se reinicia). Si el monto prorrateado se redondea a **$0** (casi no queda tiempo en el período), la mejora se aplica de inmediato sin ningún paso de pago — no habría nada de qué presentar comprobante.
- **Degradación en el mismo intervalo** (el precio del plan de destino es menor, `billingInterval` se omite o no cambia) se programa, no es inmediata, y no requiere pago — ya pagaste por el período actual en el plan superior. Tu plan y cuota se mantienen exactamente igual hasta `current_period_end`. El job programado del proveedor lo aplica automáticamente una vez que pasa esa fecha.
- **Cualquier cambio de intervalo de facturación** (por ejemplo, mensual → anual, o viceversa — sin importar si el plan también cambia) siempre se **difiere hasta `current_period_end` y se cobra al precio completo del nuevo plan+intervalo, nunca prorrateado**. Las cadencias distintas no pueden acreditarse limpiamente entre sí, así que tu período actual simplemente se agota tal como ya fue pagado, y la nueva cadencia inicia su propio período nuevo, totalmente pagado. Igual subes el comprobante y pasas por la revisión de la misma forma, pero el cambio de plan/intervalo solo entra en vigor una vez que llega `current_period_end` — incluso si el plan técnicamente está *subiendo*. Por ejemplo, cambiar de GROWTH mensual a STARTER anual cobra el precio completo de STARTER anual y entra en vigor una vez que termina tu período actual de GROWTH mensual, no de inmediato.

Solo puede haber un cambio de plan/intervalo pendiente a la vez — si solicitas otro antes de que el actual se resuelva, obtendrás `409 TIER_CHANGE_ALREADY_PENDING`.

**En sandbox, los tres comportamientos anteriores se reducen a dos más simples.** El período de facturación de una suscripción en sandbox se descarta por completo en el momento en que [promocionas](promote-tenant.md) — no hay nada significativo contra qué prorratear o a qué diferir un cambio. Entonces, mientras sigas en sandbox: una degradación se aplica **de inmediato y sin costo**, y todo lo demás (una mejora, o cualquier cambio de intervalo de facturación) se cobra al **precio completo** del plan de destino, nunca prorrateado, y se aplica **de inmediato** una vez que su factura autofacturada se autoriza — nunca se programa para el límite de un período. Una vez que promociones a producción, los tres comportamientos descritos anteriormente (mismo intervalo/cambio de intervalo) toman el control normalmente.

## Cuerpo de la solicitud

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `tier` | string | Sí | `STARTER`, `GROWTH`, o `BUSINESS`. |
| `billingInterval` | string | No | `MONTHLY` o `YEARLY`. Omítelo para mantener el intervalo actual de tu suscripción. Al menos uno de `tier`/`billingInterval` debe cambiar realmente respecto a tu suscripción actual, o obtendrás `400 TIER_CHANGE_NO_OP`. |

## Respuesta

**201 Created** — mejora en el mismo intervalo (pago requerido)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tenant_id": 4,
    "tier": "STARTER",
    "billing_interval": "MONTHLY",
    "status": "ACTIVE",
    "current_period_start": "2026-06-15T00:00:00.000Z",
    "current_period_end": "2026-07-15T00:00:00.000Z"
  },
  "payment": {
    "id": 25,
    "subscription_id": 12,
    "status": "PENDING",
    "amount": "30.00",
    "method": "SPI_TRANSFER",
    "purpose": "TIER_CHANGE",
    "target_tier": "GROWTH",
    "target_billing_interval": null
  },
  "bankTransfer": {
    "bankName": "...",
    "accountType": "...",
    "accountNumber": "...",
    "accountHolder": "...",
    "identification": "..."
  }
}
```

**201 Created** — mejora en el mismo intervalo aplicándose de inmediato (monto prorrateado redondeado a $0)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tier": "GROWTH"
  },
  "payment": null,
  "amount": 0
}
```

**201 Created** — degradación en el mismo intervalo (programada, sin pago)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tier": "GROWTH",
    "pending_tier": "STARTER"
  },
  "effectiveAt": "2026-07-15T00:00:00.000Z"
}
```

**201 Created** — cambio de intervalo de facturación (diferido, precio completo, el ejemplo de plan mostrado es una degradación)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tenant_id": 4,
    "tier": "GROWTH",
    "billing_interval": "MONTHLY",
    "status": "ACTIVE",
    "current_period_end": "2026-07-15T00:00:00.000Z"
  },
  "payment": {
    "id": 26,
    "subscription_id": 12,
    "status": "PENDING",
    "total_amount": "200.00",
    "method": "SPI_TRANSFER",
    "purpose": "TIER_CHANGE",
    "target_tier": "STARTER",
    "target_billing_interval": "YEARLY"
  },
  "bankTransfer": {
    "bankName": "...",
    "accountType": "...",
    "accountNumber": "...",
    "accountHolder": "...",
    "identification": "..."
  },
  "effectiveAt": "2026-07-15T00:00:00.000Z"
}
```

La suscripción en sí (`tier`/`billing_interval`) **no** cambia todavía en esta respuesta — solo cambia una vez que el pago se verifica, la factura autofacturada se autoriza, y llega `current_period_end`.

## Qué sucede después

Recibirás una notificación y un correo `PAYMENT_VERIFIED`/`PAYMENT_REJECTED` cuando se complete la revisión de un pago (consulta [Notifications](notifications.md)) — aún no existe notificación para el momento exacto en que el plan/intervalo de una degradación en el mismo intervalo o de un cambio de intervalo de facturación realmente cambia, ya que nada fue pagado o rechazado en ese instante exacto para dispararla. Consulta periódicamente [`GET /v1/subscriptions/me`](get-my-subscriptions.md) para conocer el estado, [`GET /v1/tenants/me`](tenant-me.md) solo para el plan/cuota resultante una vez aplicado, o [`GET /v1/tenants/events`](tenant-events.md) para ver el historial completo de cambios de plan/intervalo a lo largo del tiempo (`TIER_CHANGE_REQUESTED` → `TIER_CHANGE_SCHEDULED` → `TIER_CHANGED`, cada uno con `fromBillingInterval`/`toBillingInterval` en `detail`).

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `INVALID_TIER` | `tier` no es `STARTER`, `GROWTH`, ni `BUSINESS` |
| `400` | `INVALID_BILLING_INTERVAL` | Se proporciona `billingInterval` pero no es `MONTHLY` ni `YEARLY` |
| `400` | `TIER_CHANGE_NO_OP` | Tanto `tier` como el `billingInterval` resuelto coinciden con los valores actuales de tu suscripción |
| `401` | `UNAUTHORIZED` | Llave API ausente o inválida |
| `404` | `NOT_FOUND` | No se pudo resolver el tenant (normalmente no debería ocurrir en una solicitud autenticada) |
| `409` | `NO_ACTIVE_SUBSCRIPTION` | No tienes ninguna suscripción `ACTIVE` — promociona con un plan pago y completa esa revisión de pago primero |
| `409` | `TIER_CHANGE_ALREADY_PENDING` | Ya hay un cambio programado, o un pago ya está en curso, para esta suscripción |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
