# Crear Suscripción

Inicia una suscripción pagada para el tenant autenticado.

```
POST /v1/subscriptions
```

A diferencia de solicitar un `tier` en [Promover Tenant](promote-tenant.md), esto funciona **mientras el tenant sigue en sandbox** — no necesitas promover a producción primero para empezar a pagar por un plan. También funciona después de la promoción, para un tenant que se promovió en FREE y desea mejorar de plan más adelante.

## Autenticación

`Authorization: Bearer <api-key>`

El correo del tenant debe estar ACTIVE (verificado) — la misma validación que usa `POST /v1/tenants/promote`, ya que pagar requiere una dirección verificada registrada.

## Cuerpo de la solicitud

```json
{
  "tier": "STARTER",
  "billingInterval": "MONTHLY"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `tier` | string | Sí | `STARTER`, `GROWTH`, o `BUSINESS` — consulta [Get Tiers](get-tiers.md) |
| `billingInterval` | string | No | `MONTHLY` (por defecto) o `YEARLY` (2 meses gratis) |

## Qué sucede después

El mismo flujo manual de comprobante/revisión que el resto del sistema de suscripciones: sube el comprobante de la transferencia SPI mediante [`PATCH /v1/payments/:id/proof`](submit-payment-proof.md), el proveedor lo revisa y vincula la factura autofacturada, y el plan/cuota se aplican una vez que esa factura es autorizada por el SRI. Consulta periódicamente [`GET /v1/subscriptions/me`](get-my-subscriptions.md) para conocer el estado.

La concesión del plan/cuota en sí no depende del estado sandbox del tenant — puede aplicarse mientras sigue en sandbox. Solo importa para la aplicación de la cuota de comprobantes de producción, así que concederla anticipadamente no tiene efecto hasta que el tenant se promueva.

Si la suscripción pasa a `ACTIVE` antes de que ocurra la promoción, [`POST /v1/tenants/promote`](promote-tenant.md) lo detecta automáticamente y omite por completo la selección de plan — cualquier `tier`/`billingInterval` pasado a esa llamada se ignora, y la respuesta muestra la suscripción existente en lugar de iniciar una nueva.

## Respuesta

**201 Created**

```json
{
  "ok": true,
  "subscription": { "id": 12, "tier": "STARTER", "status": "PENDING_PAYMENT", "billing_interval": "MONTHLY" },
  "payment": { "id": 18, "status": "PENDING", "amount": "17.39", "iva_rate": "0.1500", "iva_amount": "2.61", "total_amount": "20.00" },
  "bankTransfer": { "bankName": "...", "accountType": "...", "accountNumber": "...", "accountHolder": "...", "identification": "..." }
}
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `INVALID_TIER` | `tier` no es `STARTER`, `GROWTH`, ni `BUSINESS` |
| `400` | `VALIDATION_FAILED` | `billingInterval` no es un valor reconocido |
| `401` | `UNAUTHORIZED` | Llave API ausente o inválida |
| `403` | `FORBIDDEN` (`EMAIL_VERIFICATION_REQUIRED`) | El correo del tenant aún no ha sido verificado |
| `404` | `NOT_FOUND` | No se pudo resolver el tenant (normalmente no debería ocurrir en una solicitud autenticada) |
| `409` | `SUBSCRIPTION_ALREADY_IN_FLIGHT` | El tenant ya tiene una suscripción en curso |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
