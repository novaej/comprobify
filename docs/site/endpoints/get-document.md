# Consultar Comprobante

Obtiene un comprobante mediante su clave de acceso de 49 dígitos.

```
GET /v1/documents/:accessKey
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

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

### El campo `dispatch` (solo mientras el comprobante está en tránsito)

Cuando `status` es `PENDING_SEND` o `RECEIVED`, la respuesta puede incluir un campo `dispatch` con el estado del envío/verificación de autorización asíncrona que está en curso:

```json
{
  "document": {
    "status": "PENDING_SEND",
    "dispatch": {
      "status": "FAILED",
      "attemptCount": 5,
      "lastError": "SRI reception service returned HTTP 500"
    }
  }
}
```

| Campo | Descripción |
|---|---|
| `dispatch.status` | `PENDING`/`DISPATCHED` (todavía reintentando automáticamente) o `FAILED` (agotó los 5 intentos automáticos — recién aquí tiene sentido llamar a [Reintentar Envío/Autorización](retry-send.md)) |
| `dispatch.attemptCount` | Cuántos intentos automáticos lleva (0–5) |
| `dispatch.lastError` | Mensaje del último fallo, o `null` si aún no ha fallado ningún intento |

Pensado para un cliente que sondea este endpoint mientras espera el resultado del SRI: los reintentos automáticos están espaciados 5 minutos entre sí (hasta ~20+ minutos para agotar los 5), un lapso mucho mayor a una ventana de sondeo típica — sin este campo, no hay forma de distinguir "sigue reintentando solo" de "ya se estancó" a partir del tiempo transcurrido. El campo no aparece en absoluto cuando el comprobante está en un estado asentado (`SIGNED`, `AUTHORIZED`, `RETURNED`, `NOT_AUTHORIZED`) — nada en tránsito que reportar.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | API key ausente o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | No existe ningún comprobante con esa clave de acceso para este emisor |
