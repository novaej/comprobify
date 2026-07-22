# Consultar Mis Suscripciones

Devuelve tu historial completo de suscripciones, más recientes primero, con los pagos de cada suscripción anidados.

```
GET /v1/subscriptions/me
```

## Autenticación

`Authorization: Bearer <api-key>`

## Cuándo llamar a este endpoint

Una revisión de pago (verificado/rechazado) y tanto el recordatorio de renovación como la expiración disparan una [notificación](notifications.md) y un correo — no necesitas hacer polling estrictamente. Pero aún no existe una notificación para el momento en que la factura de una suscripción se autoriza y se activa (solo se disparó una para la decisión de pago que la precedió) — después de [solicitar un plan pagado](promote-tenant.md) y [enviar el comprobante de pago](submit-payment-proof.md), consulta este endpoint periódicamente (o [`GET /v1/tenants/me`](tenant-me.md) para solo el plan/cuota resultante) para ver qué está pasando entre medio, incluyendo por qué se rechazó un pago, si fue el caso.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "subscriptions": [
    {
      "id": "00000000-0000-0000-0000-000000000012",
      "tenant_id": 4,
      "tier": "STARTER",
      "billing_interval": "MONTHLY",
      "status": "PENDING_PAYMENT",
      "initial_invoice_document_id": null,
      "current_period_start": null,
      "current_period_end": null,
      "created_at": "2026-06-29T04:45:40.225Z",
      "canceled_at": null,
      "payments": [
        {
          "id": "00000000-0000-0000-0000-000000000018",
          "status": "REJECTED",
          "amount": "17.39",
          "iva_rate": "0.1500",
          "iva_amount": "2.61",
          "total_amount": "20.00",
          "method": "SPI_TRANSFER",
          "rejection_reason_code": "TRANSFER_NOT_FOUND",
          "reported_at": "2026-06-29T04:45:40.278Z",
          "verified_at": null
        }
      ]
    }
  ]
}
```

Los archivos de comprobante en sí nunca se incluyen aquí — llama a [Listar Comprobantes de Pago](list-payment-proofs.md) para un pago y ver qué se ha subido, o [Descargar Comprobante de Pago](download-payment-proof.md) para un archivo específico. `rejection_reason_code` solo está presente en pagos `REJECTED`, y se limpia automáticamente en cuanto [reenvías el comprobante](submit-payment-proof.md) para ese pago. Es uno de un conjunto predefinido de códigos (`AMOUNT_MISMATCH`, `TRANSFER_NOT_FOUND`, `WRONG_ACCOUNT`, `ILLEGIBLE_PROOF`, `DUPLICATE_SUBMISSION`, `OTHER`) — mapéalo a tu propio mensaje de interfaz en lugar de mostrar el código sin procesar, de la misma forma en que manejarías un [`code`](../errors/index.md) de error. `amount` es la base imponible antes de IVA; `total_amount` es lo que realmente se transfirió vía SPI.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

## Notas

- Devuelve un arreglo vacío si nunca has tenido una suscripción (por ejemplo, si sigues en FREE).
- Un pago `REJECTED` no es un callejón sin salida — envía un nuevo comprobante para el *mismo* pago mediante `PATCH /v1/payments/:id/proof` usando el `id` de esta respuesta.
