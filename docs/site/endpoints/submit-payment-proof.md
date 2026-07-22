# Enviar Comprobante de Pago

Sube el comprobante de una transferencia bancaria SPI para un pago de suscripción pendiente — una captura de pantalla, PDF o foto del comprobante de la transferencia. Acepta hasta 5 archivos por solicitud; puedes llamarlo de nuevo en cualquier momento para agregar más (nada de lo ya subido se sobrescribe).

```
PATCH /v1/payments/:id/proof
```

## Autenticación

`Authorization: Bearer <api-key>`

El pago debe pertenecer a una suscripción propiedad de tu tenant. Esta es tu propia API key — no el secreto de administrador.

## Cuándo llamar a este endpoint

Después de solicitar un plan pago — ya sea mediante [`POST /v1/subscriptions`](create-subscription.md) o [`POST /v1/tenants/promote`](promote-tenant.md) (campos `tier`/`billingInterval`), o haciendo que tu proveedor inicie uno mediante la API de administración — la respuesta incluye un `payment` e instrucciones `bankTransfer`. Realiza la transferencia SPI por `payment.total_amount` (el monto total con IVA incluido) y luego llama a este endpoint con el comprobante correspondiente. El mismo flujo también cubre una renovación — aproximadamente 7 días antes del `current_period_end` de tu suscripción recibirás una notificación y un correo `SUBSCRIPTION_RENEWAL_DUE` con un nuevo `payment.id` contra el cual enviar el comprobante (ver [Notificaciones](notifications.md)).

## Cuerpo de la solicitud

`multipart/form-data`.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `proof` | archivo (repite el campo para más de uno) | Sí | PNG, JPEG, GIF o PDF. Máximo 2 MB por archivo, hasta 5 archivos por solicitud. |
| `referenceNumber` | string | Sí | El número de referencia/confirmación que tu banco te dio para la transferencia SPI. Máximo 50 caracteres. Se aplica a todos los archivos de esta solicitud — si estás reenviando después de un rechazo con una nueva transferencia, envía el número de referencia de esa nueva transferencia. |

> **Consejo:** al realizar la transferencia SPI, incluye el `payment.id` de este pago en el campo de descripción/referencia de la transferencia en tu banco (por ejemplo, "Pago Comprobify 18") — no generamos ningún otro número de orden, así que esta es la forma más fácil de que tu proveedor asocie la transferencia con tu pago al revisarlo. No todos los bancos admiten un campo de descripción, por lo que esto no es obligatorio, pero es lo más útil que puedes hacer para agilizar la revisión.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "payment": {
    "id": "00000000-0000-0000-0000-000000000018",
    "subscription_id": 12,
    "status": "REPORTED",
    "amount": "17.39",
    "iva_rate": "0.1500",
    "iva_amount": "2.61",
    "total_amount": "20.00",
    "method": "SPI_TRANSFER",
    "reported_at": "2026-06-28T23:14:03.087Z"
  },
  "proofs": [
    {
      "id": "00000000-0000-0000-0000-000000000042",
      "filename": "receipt.pdf",
      "mimeType": "application/pdf",
      "referenceNumber": "SPI-20260628-00931",
      "active": true,
      "createdAt": "2026-06-28T23:14:03.087Z"
    }
  ]
}
```

`proofs` lista únicamente el/los archivo(s) subido(s) **en esta solicitud** — llama a [Listar Comprobantes de Pago](list-payment-proofs.md) para ver el conjunto completo subido hasta el momento (este pago puede tener otros de un intento anterior). Los bytes crudos del archivo nunca se devuelven en la respuesta, solo los metadatos; usa [Descargar Comprobante de Pago](download-payment-proof.md) con un `proofId` de esta respuesta para volver a obtenerlos. `status` pasa a `REPORTED`. Tu proveedor revisa los archivos y verifica o rechaza el pago; una vez verificado, autofactura el comprobante y la suscripción se activa automáticamente en cuanto el SRI lo autoriza. Una vez que un pago está `VERIFIED`, ya no se aceptan más subidas (ni eliminaciones) para él — todo lo relativo a su comprobante queda fijo en ese punto.

## Qué sucede después

Recibirás una notificación y un correo `PAYMENT_VERIFIED` o `PAYMENT_REJECTED` tan pronto tu proveedor registre su decisión (ver [Notificaciones](notifications.md)) — no necesitas consultar activamente, aunque [`GET /v1/subscriptions/me`](get-my-subscriptions.md) (estados intermedios y cualquier motivo de rechazo) y [`GET /v1/tenants/me`](tenant-me.md) (el tier/cuota resultante una vez aplicado) también están siempre disponibles.

**Si tu comprobante es rechazado**, el correo explica el motivo en lenguaje claro, y `GET /v1/subscriptions/me` muestra el mismo motivo como un `rejection_reason_code` estable (uno de `AMOUNT_MISMATCH`, `TRANSFER_NOT_FOUND`, `WRONG_ACCOUNT`, `ILLEGIBLE_PROOF`, `DUPLICATE_SUBMISSION`, `OTHER`) para que tu propia interfaz lo asocie a un mensaje. Una vez que hayas corregido lo que se señaló, llama de nuevo a este mismo endpoint con un nuevo comprobante para el mismo pago — los archivos del intento rechazado permanecen exactamente donde están (ver [Listar Comprobantes de Pago](list-payment-proofs.md) y [Eliminar Comprobante de Pago](delete-payment-proof.md) si deseas quitar alguno), simplemente estás agregando más. El rechazo no es un callejón sin salida; solo un pago ya `VERIFIED` rechaza subidas adicionales.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `INVALID_FILE_UPLOAD` | No se envió ningún archivo, un archivo no es PNG/JPEG/GIF/PDF, o un archivo supera los 2 MB |
| `400` | `VALIDATION_FAILED` | `referenceNumber` faltó, estaba vacío, o superaba los 50 caracteres |
| `400` | `PROOF_FILE_LIMIT_REACHED` | Este pago ya tiene el número máximo de archivos de comprobante activos (10 en total, considerando todos los intentos de subida) — elimina uno primero mediante [Eliminar Comprobante de Pago](delete-payment-proof.md) |
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `404` | `PAYMENT_NOT_FOUND` | El pago no existe, o pertenece a otro tenant |
| `409` | `CONFLICT` | El pago ya estaba `VERIFIED` y no puede aceptar más comprobantes |
