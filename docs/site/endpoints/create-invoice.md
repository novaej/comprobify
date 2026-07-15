# Crear Factura

Crea, valida y firma una nueva factura electrónica.

```
POST /v1/documents
```

Para notas de crédito (`documentType: "04"`), consulta [Crear Nota de Crédito](create-credit-note.md) — el cuerpo de la solicitud es diferente (sin bloque `payments`; requiere `originalDocument` + `motivo` en su lugar).

## Autenticación

`Authorization: Bearer <api-key>`

## Headers

| Header | Requerido | Descripción |
|---|---|---|
| `Authorization` | Sí | Llave API tipo Bearer |
| `X-Issuer-Id` | Sí | Id numérico de la sucursal emisora (obtenido de `GET /v1/issuers`). Identifica qué sucursal y certificado usar. |
| `Content-Type` | Sí | `application/json` |
| `Idempotency-Key` | No | String único (máx. 255 caracteres) — consulta [idempotencia](#idempotency) |

## Cuerpo de la solicitud

```json
{
  "documentType": "01",
  "issueDate": "15/03/2026",
  "buyer": {
    "idType": "05",
    "id": "1234567890",
    "name": "John Doe",
    "email": "john@example.com",
    "address": "Av. Amazonas 123"
  },
  "items": [
    {
      "mainCode": "PROD-001",
      "auxiliaryCode": "AUX-001",
      "description": "Web development service",
      "quantity": "1.00",
      "unitPrice": "100.00",
      "discount": "0.00",
      "taxes": [
        {
          "code": "2",
          "rateCode": "2",
          "rate": "15.00",
          "taxableBase": "100.00",
          "taxAmount": "15.00"
        }
      ]
    }
  ],
  "payments": [
    {
      "method": "01",
      "total": "115.00",
      "term": 30,
      "termUnit": "dias"
    }
  ],
  "additionalInfo": [
    { "name": "Contract", "value": "CTR-2026-001" }
  ]
}
```

### Referencia de campos

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `documentType` | string | Sí | Código de tipo de comprobante. Usa `"01"` para esta forma de cuerpo (factura). Para `"04"` (nota de crédito), consulta [Crear Nota de Crédito](create-credit-note.md) |
| `issueDate` | string | No | Fecha en formato `DD/MM/YYYY`. Debe ser la fecha de hoy — el SRI rechaza fechas pasadas y futuras. Por defecto, hoy si se omite |
| `buyer.idType` | string | Sí | Código de tipo de identificación SRI de 2 dígitos (p. ej. `"05"` = cédula, `"04"` = RUC) |
| `buyer.id` | string | Sí | Número de identificación del comprador (máx. 20 caracteres) |
| `buyer.name` | string | Sí | Nombre completo o razón social del comprador (máx. 300 caracteres) |
| `buyer.email` | string | Sí | Correo del comprador — el RIDE y el XML se envían aquí al momento de la autorización |
| `buyer.address` | string | No | Dirección del comprador (máx. 300 caracteres) |
| `guiaRemision` | string | No | Número de guía de remisión en formato `NNN-NNN-NNNNNNNNN` (p. ej. `001-001-000000001`) |
| `items` | array | Sí | Se requiere al menos un ítem |
| `items[].mainCode` | string | Sí | Código principal del producto/servicio |
| `items[].auxiliaryCode` | string | No | Código secundario |
| `items[].description` | string | Sí | Descripción (máx. 300 caracteres) |
| `items[].quantity` | string | Sí | Cantidad numérica |
| `items[].unitPrice` | string | Sí | Precio unitario numérico |
| `items[].discount` | string | No | Monto numérico de descuento |
| `items[].taxes` | array | Sí | Al menos un impuesto por ítem |
| `items[].taxes[].code` | string | Sí | Código de tipo de impuesto SRI |
| `items[].taxes[].rateCode` | string | Sí | Código de tarifa de impuesto SRI |
| `items[].taxes[].rate` | string | Sí | Porcentaje de la tarifa de impuesto |
| `items[].taxes[].taxableBase` | string | Sí | Monto sobre el cual se aplica el impuesto |
| `items[].taxes[].taxAmount` | string | Sí | Monto de impuesto calculado |
| `payments` | array | Sí | Se requiere al menos un pago |
| `payments[].method` | string | Sí | Código de forma de pago SRI de 2 dígitos |
| `payments[].total` | string | Sí | Monto numérico del pago |
| `payments[].term` | number | No | Duración del plazo de pago — corresponde al `plazo` del SRI |
| `payments[].termUnit` | string | No | Código de unidad del plazo de pago — corresponde al `unidadTiempo` del SRI. Debe ser uno de los valores devueltos por `GET /v1/catalogs/term-units` (p. ej. `"dias"`, `"meses"`) |
| `additionalInfo` | array | No | Pares clave-valor incluidos en el XML como `campoAdicional` |

## Respuesta

**201 Created** — nuevo comprobante creado.
**200 OK** — se devuelve cuando el mismo `Idempotency-Key` + carga útil idéntica ya fue procesado.

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "SIGNED",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "email": {
      "status": "PENDING"
    }
  }
}
```

## Idempotencia

Incluye un header `Idempotency-Key` para hacer que la creación sea idempotente. Genera la clave una sola vez por factura prevista y reutilízala en los reintentos:

- Misma clave + mismo payload → devuelve el comprobante existente (no se crea un duplicado)
- Misma clave + payload diferente → `409 Conflict`

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `VALIDATION_FAILED` | 400 | El cuerpo de la solicitud falla la validación de campos |
| `DOCUMENT_TYPE_NOT_ENABLED` | 400 | El emisor no tiene habilitado el tipo de comprobante `01` — consulta [Document Types](document-types.md) |
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o está mal formado |
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida, o desajuste de ambiente (llave sandbox apuntando a un emisor de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a un tenant diferente |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `CONFLICT` | 409 | Se reutilizó la clave de idempotencia con un payload diferente |
| `INTERNAL_ERROR` | 500 | Error inesperado del servidor |
