# Descargar Comprobante de Pago

Descarga un archivo específico de comprobante de transferencia que subiste previamente para un pago.

```
GET /v1/payments/:id/proofs/:proofId
```

## Autenticación

`Authorization: Bearer <api-key>`

El pago debe pertenecer a una suscripción de tu tenant, y el archivo debe seguir activo — un archivo [eliminado](delete-payment-proof.md) ya no se puede descargar mediante este endpoint (tu proveedor todavía puede verlo y descargarlo desde su lado, con fines de auditoría).

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | El ID del pago |
| `proofId` | El `id` del archivo de comprobante, obtenido de [Listar Comprobantes de Pago](list-payment-proofs.md) o de la respuesta de [Enviar Comprobante de Pago](submit-payment-proof.md) |

## Respuesta

**200 OK** — el archivo sin procesar, transmitido directamente.

| Header | Valor |
|---|---|
| `Content-Type` | El tipo MIME del archivo subido (`image/png`, `image/jpeg`, `image/gif`, o `application/pdf`) |
| `Content-Disposition` | `inline; filename="<nombre de archivo original>"` |

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | Llave API ausente o inválida |
| `404` | `NOT_FOUND` | El pago no existe, pertenece a otro tenant, el comprobante no pertenece a este pago, o fue eliminado |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
