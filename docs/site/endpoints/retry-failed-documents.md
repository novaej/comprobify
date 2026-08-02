# Reintentar Todos los Comprobantes Fallidos

Variante masiva de [Reintentar Envío/Autorización](retry-send.md) — recupera **todos** los comprobantes estancados del tenant autenticado de una sola vez, sin necesidad de conocer sus claves de acceso individuales.

```
POST /v1/tenants/retry-failed-documents
```

A diferencia de los endpoints bajo `/v1/documents/*`, este **no requiere `X-Issuer-Id`** — cubre todos los emisores/sucursales del tenant en una sola llamada. Es la forma recomendada de recuperarse de una interrupción del servicio del SRI que afectó a varios comprobantes en distintas sucursales a la vez, en lugar de llamar a [Reintentar Envío/Autorización](retry-send.md) una vez por cada comprobante.

Es "mejor esfuerzo" por comprobante — si el reencolado de uno falla (por ejemplo, RabbitMQ momentáneamente no disponible), no detiene el resto; ese comprobante en particular simplemente queda cubierto por el siguiente ciclo del job de reconciliación.

## Autenticación

`Authorization: Bearer <api-key>` (sin `X-Issuer-Id`)

## Respuesta

**202 Accepted**

```json
{
  "ok": true,
  "retried": 3,
  "effects": [
    { "id": "019fbf85-4751-7a22-82d9-479022d58b0f", "effectType": "SRI_SEND", "status": "PENDING", "attemptCount": 0 },
    { "id": "019fbf9a-1122-7a22-82d9-479022d58b0f", "effectType": "SRI_AUTHORIZE", "status": "PENDING", "attemptCount": 0 }
  ]
}
```

`retried` es la cantidad de comprobantes que efectivamente tenían un intento fallido y fueron reencolados — `0` es una respuesta válida y significa que no había nada que recuperar.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `UNAUTHORIZED` | 401 | API key faltante o inválida |
