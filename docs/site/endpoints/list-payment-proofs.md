# Listar Comprobantes de Pago

Devuelve los metadatos (no los bytes del archivo) de cada comprobante de pago que has subido para un pago que sigue activo — es decir, que no ha sido eliminado.

```
GET /v1/payments/:id/proofs
```

## Autenticación

`Authorization: Bearer <api-key>`

El pago debe pertenecer a una suscripción propiedad de tu tenant.

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | El ID del pago |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "proofs": [
    {
      "id": "00000000-0000-0000-0000-000000000042",
      "filename": "receipt.pdf",
      "mimeType": "application/pdf",
      "referenceNumber": "SPI-20260628-00931",
      "active": true,
      "createdAt": "2026-06-28T23:14:03.087Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000043",
      "filename": "bank-statement.png",
      "mimeType": "image/png",
      "referenceNumber": "SPI-20260628-00931",
      "active": true,
      "createdAt": "2026-06-29T10:02:11.400Z"
    }
  ]
}
```

Aquí solo se devuelven los archivos con `active: true` — un archivo que hayas [eliminado](delete-payment-proof.md) desaparece de esta lista (aunque no desaparece de la vista de tu proveedor; consulta esa página). Usa el `id` de un comprobante con [Download Payment Proof](download-payment-proof.md) para obtener el archivo real. `referenceNumber` es la referencia de la transferencia bancaria que indicaste al subirlo — todos los archivos del mismo [envío](submit-payment-proof.md) comparten el mismo valor; un reenvío posterior (por ejemplo, después de un rechazo) puede tener uno diferente si hiciste una nueva transferencia.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `404` | `PAYMENT_NOT_FOUND` | El pago no existe, o pertenece a otro tenant |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
