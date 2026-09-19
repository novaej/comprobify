# Consultar Tenant Actual

Devuelve la identidad y los detalles de la cuenta del tenant propietario de la API key usada para autenticar la solicitud. Útil para una aplicación de terceros que ya tiene una API key (por ejemplo, una llave que generaste desde tu panel) y necesita resolver el `tenant.id` — por ejemplo, para vincular una cuenta API existente en un frontend sin volver a ingresar el RUC o el certificado P12, o para hacer coincidir los envíos de webhooks entrantes con la cuenta correcta.

```
GET /v1/tenants/me
```

## Autenticación

`Authorization: Bearer <api-key>`

## Respuesta

```json
{
  "ok": true,
  "tenant": {
    "id": "00000000-0000-0000-0000-000000000042",
    "email": "owner@example.com",
    "subscriptionTier": "GROWTH",
    "status": "ACTIVE",
    "suspensionReasonCode": null,
    "documentCount": 128,
    "documentQuota": 1000,
    "extraSeats": 2,
    "pendingExtraSeats": null,
    "sandbox": false,
    "agreementAcceptedAt": "2026-06-28T12:00:00.000Z",
    "agreementVersion": "2026-06-28"
  }
}
```

| Campo | Descripción |
|---|---|
| `id` | UUID del tenant. Úsalo para correlacionar envíos de webhooks y otros recursos asociados al tenant. |
| `email` | Correo electrónico registrado del tenant. |
| `subscriptionTier` | `FREE`, `STARTER`, `GROWTH` o `BUSINESS`. |
| `status` | `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED` o `PAST_DUE`. |
| `suspensionReasonCode` | Por qué la cuenta está suspendida: `PAYMENT_REVERSED`, `FRAUD_SUSPECTED`, `TERMS_VIOLATION`, `VOLUNTARY_CLOSURE`, `UNPAID_BALANCE` u `OTHER`. `null` salvo que `status` sea `SUSPENDED`. Es un código estable pensado para que tu interfaz muestre su propio mensaje localizado — `VOLUNTARY_CLOSURE` corresponde a un cierre de cuenta solicitado por ti, no a una sanción. |
| `documentCount` | Comprobantes emitidos en el periodo de facturación actual. |
| `documentQuota` | Límite de comprobantes para el `subscriptionTier` actual. |
| `extraSeats` | Usuarios adicionales del panel comprados por encima del número incluido en el plan (0 si no hay ninguno, o si no existe una suscripción activa). Comprobify factura esto pero no lo aplica — ver [Tu suscripción y cómo pagarla](../paying-your-subscription.md#usuarios-adicionales). |
| `pendingExtraSeats` | Un número de usuarios programado para entrar en vigencia al final del periodo de facturación actual (una reducción en curso), o `null` si no hay nada programado. |
| `sandbox` | `true` si el tenant está en el entorno de pruebas del SRI, `false` si fue promovido a producción. |
| `agreementAcceptedAt` | Timestamp del evento de aceptación de acuerdos más reciente, o `null` si el tenant aún no ha aceptado ninguno. |
| `agreementVersion` | La versión del documento TERMS que el tenant aceptó por última vez, o `null` si aún no ha aceptado ninguno. |

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `429` | `TOO_MANY_REQUESTS` | Límite de solicitudes excedido |

## Notas

- No se requiere el header `X-Issuer-Id` — este endpoint resuelve el tenant, no un emisor.
- La respuesta refleja exactamente lo que el middleware `authenticate` ya resolvió a partir de la API key — no hay una consulta separada a la base de datos, por lo que cualquier llave activa (sandbox o producción) devuelve el estado actual de su tenant.
- Esto no devuelve la lista de emisores (sucursales) — usa `GET /v1/issuers` para eso.
- `suspensionReasonCode` te dice *por qué* la cuenta fue suspendida sin tener que revisar [`GET /v1/tenants/events`](tenant-events.md); el historial completo (incluidas suspensiones anteriores ya levantadas) sigue estando ahí, en el `detail` de los eventos `STATUS_CHANGED`.
- A diferencia de la mayoría de los endpoints autenticados, este sigue siendo accesible incluso cuando `status` es `SUSPENDED` — es uno de un pequeño conjunto de endpoints de solo lectura que un tenant suspendido todavía puede usar (ver la entrada `ACCOUNT_SUSPENDED` en el [catálogo de errores](../errors/index.md)). Consultar este endpoint periódicamente es una forma válida de detectar una suspensión y revisar el `status` actual de la cuenta.
- **Esta es también la forma de saber que una mejora a un plan pago se completó.** Después de solicitar un plan en la [promoción](../account-lifecycle.md#pasar-a-produccion) y [Tu suscripción y cómo pagarla](../paying-your-subscription.md), recibirás una [notificación](notifications.md) y un correo en el momento en que tu proveedor registre su decisión — y esa decisión *es* la activación: `subscriptionTier` y `documentQuota` ya reflejan el plan nuevo cuando llega la notificación `PAYMENT_VERIFIED`. No hay que esperar a ningún paso posterior de facturación. Para los estados intermedios (pendiente, rechazado, motivo) usa [Tu suscripción y cómo pagarla](../paying-your-subscription.md) en su lugar — este endpoint solo muestra el resultado final.
