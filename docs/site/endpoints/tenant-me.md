# Consultar Tenant Actual

Devuelve la identidad y los detalles de la cuenta del tenant propietario de la API key usada para autenticar la solicitud. Útil para una aplicación de terceros que ya tiene una API key (por ejemplo, emitida mediante `POST /v1/register` o por un administrador) y necesita resolver el `tenant.id` — por ejemplo, para vincular una cuenta API existente en un frontend sin volver a ingresar el RUC o el certificado P12, o para hacer coincidir los envíos de webhooks entrantes con la cuenta correcta.

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
    "documentCount": 128,
    "documentQuota": 1000,
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
| `status` | `PENDING_VERIFICATION`, `ACTIVE` o `SUSPENDED`. |
| `documentCount` | Comprobantes emitidos en el periodo de facturación actual. |
| `documentQuota` | Límite de comprobantes para el `subscriptionTier` actual. |
| `sandbox` | `true` si el tenant está en el entorno de pruebas del SRI, `false` si fue promovido a producción. |
| `agreementAcceptedAt` | Timestamp del evento de aceptación de acuerdos más reciente, o `null` para tenants creados por un administrador. Compáralo con `GET /v1/tenants/agreements` para detectar desactualizaciones. |
| `agreementVersion` | La versión del documento TERMS que el tenant aceptó por última vez, o `null` para tenants creados por un administrador. |

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `429` | `TOO_MANY_REQUESTS` | Límite de tasa excedido |

## Notas

- No se requiere el header `X-Issuer-Id` — este endpoint resuelve el tenant, no un emisor.
- La respuesta refleja exactamente lo que el middleware `authenticate` ya resolvió a partir de la API key — no hay una consulta separada a la base de datos, por lo que cualquier llave activa (sandbox o producción) devuelve el estado actual de su tenant.
- Esto no devuelve la lista de emisores (sucursales) — usa `GET /v1/issuers` para eso.
- A diferencia de la mayoría de los endpoints autenticados, este sigue siendo accesible incluso cuando `status` es `SUSPENDED` — es uno de un pequeño conjunto de endpoints de solo lectura que un tenant suspendido todavía puede usar (ver la entrada `ACCOUNT_SUSPENDED` en el [catálogo de errores](../errors/index.md)). Consultar este endpoint periódicamente es una forma válida de detectar una suspensión y revisar el `status` actual de la cuenta.
- **Esta es también la forma de saber que una mejora a un plan pago se completó.** Después de solicitar un plan en la [promoción](promote-tenant.md) y [enviar el comprobante de pago](submit-payment-proof.md), recibirás una [notificación](notifications.md) y un correo en el momento en que tu proveedor registre una decisión, pero la activación final (una vez que el SRI autoriza la factura autofacturada) todavía no tiene notificación propia — consulta este endpoint periódicamente; `subscriptionTier` y `documentQuota` se actualizan en el momento en que la suscripción se activa. Para los estados intermedios (pendiente, rechazado, motivo) usa [`GET /v1/subscriptions/me`](get-my-subscriptions.md) en su lugar — este endpoint solo muestra el resultado final.
