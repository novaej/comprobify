# Listar Comprobantes

Obtiene una lista paginada de comprobantes del emisor autenticado, con filtros opcionales por estado, tipo de comprobante, rango de fechas, secuencial y nombre del comprador, y ordenamiento opcional.

```
GET /v1/documents
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (id numérico de `GET /v1/issuers`)

## Parámetros de consulta

| Parámetro | Tipo | Descripción |
|---|---|---|
| `status` | string | Filtra por estado: `SIGNED`, `RECEIVED`, `RETURNED`, `AUTHORIZED`, `NOT_AUTHORIZED` (opcional) |
| `documentType` | string | Filtra por código de tipo de comprobante: `01`, `03`, `04`, `05`, `06`, `07` (opcional) |
| `from` | string | Filtra por fecha de emisión >= formato DD/MM/YYYY (opcional) |
| `to` | string | Filtra por fecha de emisión <= formato DD/MM/YYYY (opcional) |
| `sequential` | string | Filtra por secuencial, coincidencia parcial contra el valor de 9 dígitos con ceros a la izquierda (por ejemplo, `000000001`), sin distinción entre mayúsculas y minúsculas (opcional) |
| `buyerName` | string | Filtra por nombre del comprador, coincidencia parcial, sin distinción entre mayúsculas y minúsculas (opcional) |
| `sortBy` | string | Ordena por `sequential`, `buyerName`, `issueDate`, o `status` (opcional). Si se omite, los resultados se ordenan por fecha de creación (más reciente primero) — sin cambios de comportamiento para los llamadores existentes |
| `sortDir` | string | `asc` o `desc` (opcional). Por defecto `desc` cuando se indica `sortBy` sin `sortDir` |
| `page` | integer | Número de página, por defecto 1 (opcional) |
| `limit` | integer | Resultados por página, 1-100, por defecto 10 (opcional) |

Todos los filtros se combinan con `AND`.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "data": [
    {
      "accessKey": "1503202601179234567800110010010000000011234567810",
      "documentType": "01",
      "sequential": "000000001",
      "status": "AUTHORIZED",
      "issueDate": "15/03/2026",
      "total": "115.00",
      "authorizationNumber": "1503202601179234567800110010010000000011234567810",
      "authorizationDate": "2026-03-15T14:22:00-05:00",
      "email": {
        "status": "DELIVERED",
        "sentAt": "2026-03-15T14:22:05.123Z"
      }
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10
  }
}
```

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | El encabezado `X-Issuer-Id` falta o está mal formado |
| `VALIDATION_FAILED` | 400 | Parámetro de consulta inválido (por ejemplo, estado inválido, formato de fecha inválido) |
| `UNAUTHORIZED` | 401 | Llave API faltante o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
