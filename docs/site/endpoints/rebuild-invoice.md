# Reconstruir Factura

Corrige y vuelve a firmar un comprobante rechazado. El comprobante reconstruido conserva el mismo `accessKey`, `sequential`, y `issueDate` que el original — solo se reemplaza el contenido de la factura.

```
POST /v1/documents/:accessKey/rebuild
```

Úsalo cuando un comprobante está en estado `RETURNED` o `NOT_AUTHORIZED`. Después de reconstruirlo, envíalo de nuevo con [Send to SRI](send-to-sri.md).

Funciona para cualquier tipo de comprobante — la forma del cuerpo debe coincidir con el `documentType` existente del comprobante. El ejemplo a continuación es para una factura (`01`); para una nota de crédito (`04`), usa la forma del cuerpo de [Create Credit Note](create-credit-note.md) (sin `payments`, requiere `originalDocument` + `motivo`).

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante a reconstruir |

## Cuerpo de la solicitud

```json
{
  "documentType": "01",
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

### Qué se conserva del comprobante original

Los siguientes campos **siempre se toman del comprobante original** y no pueden cambiarse mediante la reconstrucción:

| Campo | Razón |
|---|---|
| `accessKey` | El SRI vincula todas las verificaciones de estado posteriores a esta clave |
| `sequential` | Los números secuenciales se asignan una sola vez y no se reciclan |
| `issueDate` | El SRI valida la fecha embebida en la clave de acceso |
| `documentType` | No se puede cambiar el tipo de un comprobante existente |

El campo `documentType` sigue siendo requerido por la validación, pero debe coincidir con el tipo del comprobante original — el valor proporcionado en el cuerpo se ignora a nivel de servicio.

### Qué se puede corregir

Todos los campos de contenido de la factura se reemplazan de forma atómica:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `documentType` | string | Sí | Debe coincidir con el tipo del comprobante original (por ejemplo, `"01"`) |
| `buyer.idType` | string | Sí | Código de tipo de identificación del SRI de 2 dígitos |
| `buyer.id` | string | Sí | Número de identificación del comprador (máx. 20 caracteres) |
| `buyer.name` | string | Sí | Nombre completo o razón social del comprador (máx. 300 caracteres) |
| `buyer.email` | string | Sí | Correo del comprador — usado cuando se envía el correo de autorización |
| `buyer.address` | string | No | Dirección del comprador (máx. 300 caracteres) |
| `guiaRemision` | string | No | Número de guía de remisión en formato `NNN-NNN-NNNNNNNNN` |
| `items` | array | Sí | Reemplaza todos los ítems existentes, incluyendo los impuestos |
| `items[].mainCode` | string | Sí | Código principal del producto/servicio |
| `items[].auxiliaryCode` | string | No | Código secundario |
| `items[].description` | string | Sí | Descripción (máx. 300 caracteres) |
| `items[].quantity` | string | Sí | Cantidad numérica |
| `items[].unitPrice` | string | Sí | Precio unitario numérico |
| `items[].discount` | string | No | Monto numérico de descuento |
| `items[].taxes` | array | Sí | Al menos un impuesto por ítem |
| `items[].taxes[].code` | string | Sí | Código de tipo de impuesto del SRI |
| `items[].taxes[].rateCode` | string | Sí | Código de tarifa de impuesto del SRI |
| `items[].taxes[].rate` | string | Sí | Porcentaje de la tarifa de impuesto |
| `items[].taxes[].taxableBase` | string | Sí | Monto sobre el que se aplica el impuesto |
| `items[].taxes[].taxAmount` | string | Sí | Monto de impuesto calculado |
| `payments` | array | Sí | Reemplaza todas las formas de pago existentes. La suma de `total` debe ser igual al total de la factura |
| `payments[].method` | string | Sí | Código de forma de pago del SRI de 2 dígitos |
| `payments[].total` | string | Sí | Monto numérico del pago |
| `payments[].term` | number | No | Plazo de pago |
| `payments[].termUnit` | string | No | Unidad del plazo de pago (por ejemplo, `"dias"`, `"meses"`) |
| `additionalInfo` | array | No | Reemplaza todas las entradas `campoAdicional` existentes |

El payload original está disponible en el campo `requestPayload` de la respuesta de [Get Document](get-document.md) — úsalo para prellenar la solicitud corregida.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "SIGNED",
    "issueDate": "15/03/2026",
    "total": "120.00",
    "buyer": {
      "id": "1234567890",
      "idType": "05",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "email": {
      "status": "PENDING"
    }
  }
}
```

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `VALIDATION_FAILED` | 400 | El cuerpo de la solicitud falla la validación de campos |
| `VALIDATION_FAILED` | 400 | La suma de `payments[].total` no coincide con el total calculado de la factura |
| `BAD_REQUEST` | 400 | El encabezado `X-Issuer-Id` falta o está mal formado |
| `INVALID_STATE_TRANSITION` | 400 | El comprobante no está en estado `RETURNED` o `NOT_AUTHORIZED` |
| `UNAUTHORIZED` | 401 | Llave API faltante o inválida, o discrepancia de entorno |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
