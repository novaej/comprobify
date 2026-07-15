# Consultar Eventos

Devuelve el historial completo de eventos de auditoría de un comprobante en orden cronológico.

```
GET /v1/documents/:accessKey/events
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (id numérico obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "events": [
    {
      "eventType": "CREATED",
      "fromStatus": null,
      "toStatus": "SIGNED",
      "detail": null,
      "createdAt": "2026-03-15T14:20:00.000Z"
    },
    {
      "eventType": "SENT",
      "fromStatus": "SIGNED",
      "toStatus": "RECEIVED",
      "detail": null,
      "createdAt": "2026-03-15T14:21:00.000Z"
    },
    {
      "eventType": "STATUS_CHANGED",
      "fromStatus": "RECEIVED",
      "toStatus": "AUTHORIZED",
      "detail": { "authorizationNumber": "1503202601179234567800110010010000000011234567810" },
      "createdAt": "2026-03-15T14:22:00.000Z"
    },
    {
      "eventType": "EMAIL_SENT",
      "fromStatus": null,
      "toStatus": null,
      "detail": null,
      "createdAt": "2026-03-15T14:22:05.000Z"
    }
  ]
}
```

### Tipos de evento

| Evento | Significado |
|---|---|
| `CREATED` | Comprobante creado y firmado |
| `SENT` | Enviado al SRI |
| `STATUS_CHANGED` | El SRI devolvió un nuevo estado |
| `REBUILT` | El comprobante fue reconstruido tras un rechazo |
| `ERROR` | Ocurrió un error durante una operación del ciclo de vida |
| `EMAIL_SENT` | Correo de autorización enviado al comprador |
| `EMAIL_FAILED` | Se intentó enviar el correo y falló |
| `EMAIL_SKIPPED` | El correo no se envió intencionalmente (por ejemplo, no hay correo del comprador registrado) — no se intentó el envío |
| `EMAIL_DELIVERED` | Mailgun confirmó la entrega al servidor de correo del destinatario |
| `EMAIL_TEMP_FAILED` | Falla temporal de entrega — Mailgun reintentará |
| `EMAIL_COMPLAINED` | El destinatario marcó el correo como spam |

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
