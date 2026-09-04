# Anular Comprobante

Marca un comprobante `AUTHORIZED` como `VOIDED`. El SRI no tiene un servicio SOAP para anular un comprobante ya autorizado — esa anulación ocurre en el propio portal del SRI. Este endpoint solo sincroniza el registro local **después** de que ya anulaste el comprobante ahí; no llama al SRI ni verifica que la anulación haya ocurrido realmente.

```
POST /v1/documents/:accessKey/void
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante a anular |

## Cuerpo de la solicitud

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `confirmedSriVoid` | boolean | Sí | Debe ser `true` — es tu confirmación explícita de que ya anulaste este comprobante en el portal del SRI |
| `reason` | string | Sí | Motivo de la anulación (máx. 500 caracteres) — solo para fines de auditoría, nunca se envía al SRI |

```json
{
  "confirmedSriVoid": true,
  "reason": "Factura duplicada — el cliente ya recibió el original 001-001-000000010"
}
```

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "VOIDED",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "buyer": {
      "id": "1234567890",
      "idType": "05",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "voidReason": "Factura duplicada — el cliente ya recibió el original 001-001-000000010",
    "voidedAt": "2026-03-20T14:32:10.000Z",
    "email": {
      "status": "SENT"
    }
  }
}
```

## Qué no cambia

- El RIDE, el XML y el correo de autorización siguen disponibles sin cambios — son el registro congelado de lo que el SRI realmente autorizó.
- Un comprobante anulado **sigue contando** en las estadísticas del mes (`GET /v1/documents/stats`) y en la cuota de comprobantes del tenant — anular corrige el libro contable ante el SRI, no deshace que el comprobante fue emitido.
- La anulación es irreversible — `VOIDED` es un estado terminal, igual que `AUTHORIZED`.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Falta `reason`, excede 500 caracteres, o `confirmedSriVoid` no es un booleano |
| `DOCUMENT_VOID_CONFIRMATION_REQUIRED` | 400 | `confirmedSriVoid` no es `true` |
| `BAD_REQUEST` | 400 | El encabezado `X-Issuer-Id` falta o está mal formado |
| `UNAUTHORIZED` | 401 | API key faltante o inválida, o discrepancia de entorno |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant, o la API key no tiene el scope `documents:void` |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
| `DOCUMENT_NOT_AUTHORIZED` | 400 | El comprobante no está en estado `AUTHORIZED` (incluye el caso de que ya esté `VOIDED`) |
