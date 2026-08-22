# Pausar/Reanudar Emisión

Pausa o reanuda la creación de comprobantes nuevos en un emisor (punto de emisión) sin desactivarlo. El historial del emisor, sus comprobantes existentes (RIDE, XML, correo) y todos los endpoints de solo lectura siguen funcionando con normalidad mientras está pausado — solo se bloquean `POST /v1/documents` y `POST /:accessKey/rebuild` dirigidos a este emisor.

```
PATCH /v1/issuers/:id/can-issue
```

Esta es la única forma de pausar un emisor con historial: `DELETE /v1/issuers/:id` (soft-delete) se rechaza con `ISSUER_HAS_DOCUMENTS` en cuanto el emisor ha emitido algún comprobante, en cualquiera de los dos ambientes.

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor, perteneciente a tu tenant |

## Cuerpo de la solicitud

```json
{
  "canIssue": false
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `canIssue` | boolean | Sí | `false` pausa la emisión de comprobantes nuevos; `true` la reanuda. Cualquiera de los dos sentidos siempre está permitido sobre un emisor activo — no hay ninguna otra regla de negocio. |

## Respuesta

**200 OK**

```json
{ "ok": true, "canIssue": false }
```

## Efecto

Con `canIssue: false`:

- `POST /v1/documents` con `X-Issuer-Id` apuntando a este emisor devuelve `403 ISSUER_ISSUING_PAUSED`.
- `POST /:accessKey/rebuild` sobre un comprobante de este emisor también devuelve `403 ISSUER_ISSUING_PAUSED` — una reconstrucción vuelve a firmar y reenviar al SRI, el mismo riesgo que una creación nueva.
- Todo lo demás sigue funcionando: `GET /:accessKey/ride`, `GET /:accessKey/xml`, reintentos de correo, `POST /:accessKey/send` y `GET /:accessKey/authorize` para comprobantes que ya estaban en curso, y todos los endpoints de lectura del emisor.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un UUID válido, o `canIssue` falta o no es un booleano |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `403` | `INSUFFICIENT_SCOPE` | La API key no tiene el scope `issuers:write` |
| `404` | `ISSUER_NOT_FOUND` | El id del emisor no existe, pertenece a otro tenant, o está inactivo |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
