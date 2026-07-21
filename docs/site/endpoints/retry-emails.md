# Reintentar Correos (Lote)

Reintenta el envío del correo de autorización para todos los comprobantes de este emisor cuyo `email_status` sea `PENDING` o `FAILED`.

```
POST /v1/documents/email-retry
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "result": {
    "attempted": 3,
    "succeeded": 2,
    "failed": 1
  }
}
```

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o tiene un formato inválido |
| `UNAUTHORIZED` | 401 | Llave API faltante o inválida, o hay un desajuste de entorno (una llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor indicado en `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor indicado en `X-Issuer-Id` no existe |
