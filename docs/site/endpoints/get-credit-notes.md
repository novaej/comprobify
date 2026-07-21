# Consultar Notas de Crédito de un Comprobante

Devuelve la suma de todas las notas de crédito `AUTHORIZED` ya emitidas contra un comprobante dado, más el saldo restante — de modo que quien llama pueda validar que "esta nota de crédito no puede exceder el saldo restante del comprobante original."

```
GET /v1/documents/:accessKey/credit-notes
```

`:accessKey` es la clave de acceso del **comprobante original que se está acreditando** (típicamente una factura), no la clave de una nota de crédito.

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante original |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "originalDocument": { "accessKey": "1503202601179234567800110010010000000011234567810", "total": "115.00" },
  "creditedTotal": "30.00",
  "remaining": "85.00",
  "creditNotes": [
    { "accessKey": "0104202601179234567800110010010000000121234567810", "sequential": "000000012", "total": "30.00", "issueDate": "01/04/2026" }
  ]
}
```

| Campo | Descripción |
|---|---|
| `originalDocument.accessKey` | La clave de acceso propia del comprobante (repetida en la respuesta) |
| `originalDocument.total` | El total del comprobante original |
| `creditedTotal` | Suma de `total` entre las notas de crédito encontradas, `"0.00"` si no hay ninguna |
| `remaining` | `originalDocument.total - creditedTotal` |
| `creditNotes` | Cada nota de crédito `AUTHORIZED` que referencia este comprobante — permite mostrar "este comprobante ya tiene N nota(s) de crédito" para mayor transparencia, no solo el conteo |

Solo las notas de crédito `AUTHORIZED` cuentan para `creditedTotal`. Las notas de crédito aún en `SIGNED`/`RECEIVED` (pendientes) o `RETURNED`/`NOT_AUTHORIZED` (rechazadas) quedan excluidas — nunca fueron emitidas legalmente contra el original.

::: warning Limitación conocida
Dos notas de crédito creadas una tras otra, antes de que la primera se autorice, no se verán entre sí en esta suma — no existe bloqueo contra la creación concurrente de notas de crédito. Trata `remaining` como una guía de interfaz, no como una garantía estricta contra el sobre-acreditamiento.
:::

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `accessKey` no tiene exactamente 49 dígitos |
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida, o discrepancia de entorno |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
