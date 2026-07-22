# Eliminar Comprobante de Pago

Elimina un archivo de comprobante de tu propia vista — por ejemplo, si subiste el archivo equivocado por error. Esto es una eliminación **reversible** (soft delete): tu proveedor aún puede verlo y descargarlo para sus registros, simplemente desaparece de tu propia lista en [List Payment Proofs](list-payment-proofs.md) y ya no puede [descargarse](download-payment-proof.md) con tu propia API key.

```
DELETE /v1/payments/:id/proofs/:proofId
```

## Autenticación

`Authorization: Bearer <api-key>`

El pago debe pertenecer a una suscripción propiedad de tu tenant.

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | El ID del pago |
| `proofId` | El `id` del archivo de comprobante, obtenido de [List Payment Proofs](list-payment-proofs.md) |

## Respuesta

**200 OK**

```json
{ "ok": true }
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `404` | `PAYMENT_NOT_FOUND` | El pago no existe, o pertenece a un tenant diferente |
| `404` | `NOT_FOUND` | El comprobante no pertenece a este pago, o ya fue eliminado |
| `409` | `CONFLICT` | El pago ya está `VERIFIED` — sus archivos de comprobante ya no pueden modificarse |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

## Notas

- El [límite acumulado de 10 archivos](submit-payment-proof.md) aplicado en la carga solo cuenta archivos *activos* — eliminar uno libera espacio para otra carga.
