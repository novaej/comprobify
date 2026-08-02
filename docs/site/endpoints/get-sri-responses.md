# Consultar Respuestas del SRI

Devuelve los resultados sin procesar de las llamadas SOAP al SRI registradas para un comprobante — una fila por cada intento de recepción (`POST /:accessKey/send`) o autorización (`GET /:accessKey/authorize`), en orden cronológico inverso (más recientes primero).

```
GET /v1/documents/:accessKey/sri-responses
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "sriResponses": [
    {
      "operationType": "AUTHORIZATION",
      "status": "NO_AUTORIZADO",
      "messages": [
        { "identifier": "45", "message": "RUC no existe", "additionalInfo": null, "type": "ERROR" }
      ],
      "createdAt": "2026-07-05T14:22:00.000Z"
    },
    {
      "operationType": "RECEPTION",
      "status": "RECIBIDA",
      "messages": null,
      "createdAt": "2026-07-05T14:21:00.000Z"
    },
    {
      "operationType": "RECEPTION",
      "status": "HTTP_500",
      "messages": null,
      "createdAt": "2026-07-05T14:20:00.000Z"
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `operationType` | `RECEPTION` (de `POST /:accessKey/send`) o `AUTHORIZATION` (de `GET /:accessKey/authorize`) |
| `status` | El `estado` que devolvió el SRI para esa llamada (por ejemplo, `RECIBIDA`, `DEVUELTA`, `AUTORIZADO`, `NO_AUTORIZADO`), o `HTTP_<código>` (por ejemplo, `HTTP_500`) cuando el propio servicio del SRI falló a nivel de transporte y nunca llegó a devolver un `estado` de negocio — un tipo de fallo distinto a un rechazo del comprobante, y típicamente un problema transitorio del lado del SRI, no un problema con el comprobante enviado |
| `messages` | Arreglo de mensajes de observación/error del SRI para esa llamada, o `null` si el SRI no devolvió ninguno (siempre `null` para un `status` de tipo `HTTP_<código>`, ya que nunca se llegó a interpretar una respuesta de negocio) |
| `createdAt` | Cuándo se registró la respuesta de esa llamada |

El cuerpo de la respuesta SOAP sin procesar se excluye intencionalmente — es información de diagnóstico interno, no forma parte del contrato de la API.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `accessKey` no tiene exactamente 49 dígitos |
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | API key ausente o inválida, o discrepancia de entorno |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
