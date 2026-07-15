# Conflict

**Estado HTTP:** `409 Conflict`

Un conflicto de unicidad o de estado impidió que la operación se completara.

## Códigos

### `ALREADY_VERIFIED`

Se llamó a `POST /v1/resend-verification` para una dirección de correo cuya cuenta ya está activa (correo ya verificado). No hay nada que reenviar.

**Qué hacer:** No se requiere ninguna acción — la cuenta está verificada y puede usarse con normalidad.

### `CONFLICT` (respaldo)

Se proporcionó un encabezado `Idempotency-Key` con un valor que ya fue usado para un payload de solicitud **diferente**, o se violó otra restricción de unicidad. Lee `detail`.

**Qué hacer:**

- **Reutilización de llave de idempotencia** — Cada `Idempotency-Key` debe ser única por comprobante que se pretende crear. Si estás reintentando la **misma** factura después de un fallo, reutiliza la misma llave **y** el mismo payload — la API devolverá el comprobante existente (200). Si pretendes crear una factura nueva, genera una llave nueva (p. ej. un nuevo UUID).

- **Otros conflictos** — p. ej. un par duplicado de `(branch_code, issue_point_code)` de emisor. Lee `detail` para conocer la restricción específica.

## Ejemplos de respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/conflict",
  "title":    "Conflict",
  "status":   409,
  "code":     "ALREADY_VERIFIED",
  "detail":   "Esta cuenta ya está verificada.",
  "instance": "/v1/resend-verification"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/conflict",
  "title":    "Conflict",
  "status":   409,
  "code":     "CONFLICT",
  "detail":   "Reutilización de Idempotency-Key: el cuerpo de la solicitud no coincide con la solicitud original",
  "instance": "/v1/documents"
}
```
