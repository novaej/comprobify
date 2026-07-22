# Reintentar Correo (Individual)

Reintenta el correo de autorización de un comprobante específico.

```
POST /v1/documents/:accessKey/email-retry
```

Por defecto, solo reintenta si `email_status` es `PENDING` o `FAILED`. Agrega `?force=true` para reenviarlo incluso si el correo ya se envió exitosamente.

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante |

## Parámetros de consulta

| Parámetro | Requerido | Descripción |
|---|---|---|
| `force` | No | Se establece en `true` para reenviar incluso si `email_status` ya es `SENT` o `DELIVERED` |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "result": {
    "sent": true,
    "messageId": "20260315.abc123@mg.yourdomain.com"
  }
}
```

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o tiene un formato inválido |
| `BAD_REQUEST` | 400 | El comprobante no está en estado `AUTHORIZED`, o el correo ya fue enviado y `force` no está establecido |
| `UNAUTHORIZED` | 401 | API key faltante o inválida, o hay un desajuste de entorno (una llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor indicado en `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor indicado en `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
