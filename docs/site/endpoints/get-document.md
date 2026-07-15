# Consultar Comprobante

Obtiene un comprobante mediante su clave de acceso de 49 dígitos.

```
GET /v1/documents/:accessKey
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (id numérico obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso numérica de 49 dígitos devuelta al crear el comprobante |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "document": {
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
    },
    "requestPayload": { }
  }
}
```

`requestPayload` contiene el cuerpo de la solicitud original usado para crear el comprobante. Se omite cuando es `null`. Úsalo para prellenar el formulario de [Reconstruir Factura](rebuild-invoice.md) después de que un comprobante sea rechazado.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | No existe ningún comprobante con esa clave de acceso para este emisor |
