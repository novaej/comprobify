# Promover Tenant a Producción

Promueve el tenant autenticado de sandbox a producción. Todas las sucursales (emisores) se promueven a la vez. Los contadores secuenciales se inicializan para cada combinación de emisor × tipo de comprobante. Todas las API keys de sandbox activas se revocan y se reemplazan con llaves de producción equivalentes — una por cada llave de sandbox revocada, conservando la misma etiqueta.

```
POST /v1/tenants/promote
```

Esta es una acción de **un solo sentido**. Una vez que un tenant está en producción, no puede volver a sandbox.

## Autenticación

`Authorization: Bearer <api-key>`

El correo del tenant debe estar ACTIVE (verificado) y todos los acuerdos deben estar ACCEPTED — la promoción se bloquea si no se cumple alguna de estas condiciones.

## Cuerpo de la solicitud

Todos los campos son opcionales. Un cuerpo vacío `{}` es válido.

```json
{
  "initialSequentials": [
    { "issuerId": "00000000-0000-0000-0000-000000000001", "documentType": "01", "sequential": 1 },
    { "issuerId": "00000000-0000-0000-0000-000000000002", "documentType": "01", "sequential": 1 }
  ],
  "tier": "STARTER",
  "billingInterval": "MONTHLY"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `initialSequentials` | array | No | Números secuenciales iniciales por emisor y tipo de comprobante. Cualquier combinación no listada tiene por defecto `1`. |
| `initialSequentials[].issuerId` | string (UUID) | Sí (por entrada) | UUID del emisor (de `GET /v1/issuers`) |
| `initialSequentials[].documentType` | string | Sí (por entrada) | Código de tipo de comprobante, por ejemplo `"01"` |
| `initialSequentials[].sequential` | integer | Sí (por entrada) | Siguiente número secuencial a emitir (≥ 1) |
| `tier` | string | No | `STARTER`, `GROWTH`, o `BUSINESS` — ver [Get Tiers](get-tiers.md). Omítelo para permanecer en FREE en producción; la promoción nunca espera al pago de todos modos. Se ignora si el tenant ya tiene una suscripción en curso (ver abajo). |
| `billingInterval` | string | No | `MONTHLY` (por defecto) o `YEARLY` (2 meses gratis). Se ignora si `tier` se omite o si se ignora por lo anterior. |

Solicitar un `tier` aquí inicia el pipeline de suscripción/pago (igual que el flujo dirigido por el administrador) — ver [Submit Payment Proof](submit-payment-proof.md) para lo que sucede después. La mejora de plan/cuota en sí solo se aplica una vez que esa suscripción se paga y su factura autofacturada es autorizada por el SRI; no ocurre como parte de esta llamada.

Si el tenant ya inició una suscripción antes de promoverse — vía [`POST /v1/subscriptions`](create-subscription.md), lo cual funciona incluso en sandbox — y todavía está en curso al momento de esta llamada (cualquier estado distinto de `CANCELLED`/`EXPIRED`: `PENDING_PAYMENT`, `PAYMENT_RECEIVED`, `INVOICE_PROCESSING`, o `ACTIVE`), no queda nada por seleccionar: `tier`/`billingInterval` se ignoran por completo, y la respuesta muestra esa suscripción existente en lugar de iniciar una nueva. Este es un bloqueo estricto, no solo una cortesía — evita que se abra una segunda suscripción/pago mientras una ya está esperando comprobante, revisión, o autorización de factura.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial sandbox key", "apiKey": "a3f8c2bd..." },
    { "label": "erp-integration",     "apiKey": "d94e17ac..." }
  ],
  "subscription": { "id": "00000000-0000-0000-0000-000000000012", "tier": "STARTER", "status": "PENDING_PAYMENT", "billing_interval": "MONTHLY" },
  "payment": { "id": "00000000-0000-0000-0000-000000000018", "status": "PENDING", "amount": "17.39", "iva_rate": "0.1500", "iva_amount": "2.61", "total_amount": "20.00" },
  "bankTransfer": { "bankName": "...", "accountType": "...", "accountNumber": "...", "accountHolder": "...", "identification": "..." }
}
```

`apiKeys` contiene una entrada por cada llave de sandbox que estaba activa al momento de la promoción. **Guarda todos los tokens de inmediato — se muestran solo una vez.** Distribuye cada token a la integración que antes usaba la llave de sandbox con la misma etiqueta.

`subscription`, `payment`, y `bankTransfer` solo están presentes si se proporcionó `tier` y se inició una nueva suscripción. Si el tenant ya tenía una suscripción en curso al momento de esta llamada (cualquier estado distinto de `CANCELLED`/`EXPIRED`), solo está presente `subscription` (sin `payment`/`bankTransfer` — no se creó nada nuevo). Usa `bankTransfer` para mostrarle al tenant a dónde enviar la transferencia SPI, y luego envía el comprobante — ver [Submit Payment Proof](submit-payment-proof.md).

Las llaves de sandbox se revocan automáticamente durante la promoción. Si no tenías llaves de sandbox, `apiKeys` será un arreglo vacío — genera llaves de producción vía [`POST /v1/keys`](api-keys.md#mint-a-key).

**Reinicio del período de suscripción:** si el tenant ya tiene una suscripción `ACTIVE` (pagada mientras aún estaba en sandbox), el período de facturación (`current_period_start`/`current_period_end`) se reinicia automáticamente a la fecha de promoción. Esto garantiza que el período pagado cuente tiempo de uso en producción y no tiempo de pruebas en sandbox.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `tier` o `billingInterval` no es un valor reconocido |
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `403` | `FORBIDDEN` | El correo del tenant aún no está verificado (estado `PENDING_VERIFICATION`) |
| `403` | `AGREEMENT_ACCEPTANCE_REQUIRED` | Uno o más acuerdos no han sido aceptados — llama a `GET /v1/tenants/agreements` para ver cuáles, revísalos en `GET /v1/tenants/agreements/:type`, y luego acéptalos vía `POST /v1/tenants/agreements` |
| `409` | `CONFLICT` | El tenant ya está en producción |
