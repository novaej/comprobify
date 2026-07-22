# Crear Nota de Crédito

Crea, valida y firma una nueva nota de crédito electrónica (*nota de crédito*) que hace referencia a una factura previamente autorizada.

```
POST /v1/documents
```

Este es el mismo endpoint que [Crear Factura](create-invoice.md) — la forma del cuerpo de la solicitud se selecciona según `documentType`. El cuerpo de una nota de crédito no tiene bloque `payments` y en su lugar requiere `originalDocument` (la factura que se está acreditando) más un `motivo`.

El emisor debe tener habilitado el tipo de comprobante `04` — consulta [Document Types](document-types.md).

Antes de enviar, verifica [Get Credit Notes](get-credit-notes.md) contra la clave de acceso del documento original para ver cuánto de su total ya ha sido acreditado — la API no rechaza una nota de crédito por exceder el saldo restante del original, ya que el propio SRI no impone esa restricción; es una validación del lado del cliente.

## Autenticación

`Authorization: Bearer <api-key>`

## Headers

| Header | Requerido | Descripción |
|---|---|---|
| `Authorization` | Sí | API key tipo Bearer |
| `X-Issuer-Id` | Sí | UUID de la sucursal emisora (obtenido de `GET /v1/issuers`). Identifica qué sucursal y certificado usar. |
| `Content-Type` | Sí | `application/json` |
| `Idempotency-Key` | No | String único (máx. 255 caracteres) — consulta [idempotencia](#idempotency) |

## Cuerpo de la solicitud

```json
{
  "documentType": "04",
  "issueDate": "05/04/2026",
  "buyer": {
    "idType": "05",
    "id": "1234567890",
    "name": "John Doe",
    "email": "john@example.com",
    "address": "Av. Amazonas 123"
  },
  "originalDocument": {
    "documentType": "01",
    "number": "001-001-000000027",
    "issueDate": "03/04/2026"
  },
  "motivo": "Devolución de mercadería por defecto de fabricación",
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
  "additionalInfo": [
    { "name": "Contract", "value": "CTR-2026-001" }
  ]
}
```

### Referencia de campos

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `documentType` | string | Sí | Debe ser `"04"` para esta forma de cuerpo |
| `issueDate` | string | No | Fecha en formato `DD/MM/YYYY`. Debe ser la fecha de hoy — el SRI rechaza fechas pasadas y futuras. Por defecto, hoy si se omite |
| `buyer.idType` | string | Sí | Código de tipo de identificación SRI de 2 dígitos (p. ej. `"05"` = cédula, `"04"` = RUC) |
| `buyer.id` | string | Sí | Número de identificación del comprador (máx. 20 caracteres) |
| `buyer.name` | string | Sí | Nombre completo o razón social del comprador (máx. 300 caracteres) |
| `buyer.email` | string | Sí | Correo del comprador — el RIDE y el XML se envían aquí al momento de la autorización |
| `buyer.address` | string | No | Dirección del comprador (máx. 300 caracteres) |
| `originalDocument.documentType` | string | Sí | Código de tipo de comprobante SRI del documento que se está acreditando (p. ej. `"01"` para una factura) |
| `originalDocument.number` | string | Sí | Número tipo clave de acceso del documento original, formato `NNN-NNN-NNNNNNNNN` |
| `originalDocument.issueDate` | string | Sí | Fecha de emisión del documento original, `DD/MM/YYYY` |
| `motivo` | string | Sí | Motivo de la nota de crédito (máx. 300 caracteres) |
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
| `additionalInfo` | array | No | Pares clave-valor incluidos en el XML como `campoAdicional` |

## Respuesta

**201 Created** — nuevo comprobante creado.
**200 OK** — se devuelve cuando el mismo `Idempotency-Key` + carga útil idéntica ya fue procesado.

```json
{
  "ok": true,
  "document": {
    "accessKey": "0504202604179234567800110010010000000271234567810",
    "documentType": "04",
    "sequential": "000000027",
    "status": "SIGNED",
    "issueDate": "05/04/2026",
    "total": "115.00",
    "email": {
      "status": "PENDING"
    }
  }
}
```

## Idempotencia

Incluye un header `Idempotency-Key` para hacer que la creación sea idempotente. Genera la clave una sola vez por nota de crédito prevista y reutilízala en los reintentos:

- Misma clave + mismo payload → devuelve el comprobante existente (no se crea un duplicado)
- Misma clave + payload diferente → `409 Conflict`

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `VALIDATION_FAILED` | 400 | El cuerpo de la solicitud falla la validación de campos |
| `DOCUMENT_TYPE_NOT_ENABLED` | 400 | El emisor no tiene habilitado el tipo de comprobante `04` — consulta [Document Types](document-types.md) |
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o está mal formado |
| `UNAUTHORIZED` | 401 | API key ausente o inválida, o desajuste de ambiente (llave sandbox apuntando a un emisor de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a un tenant diferente |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `CONFLICT` | 409 | Se reutilizó la clave de idempotencia con un payload diferente |
| `INTERNAL_ERROR` | 500 | Error inesperado del servidor |
