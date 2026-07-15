# Comprobify API

API REST para generar, firmar digitalmente y enviar facturas electrónicas al SRI de Ecuador (Servicio de Rentas Internas).

## Qué hace

Comprobify gestiona el ciclo de vida completo del comprobante electrónico por ti:

| Paso | Qué sucede |
|---|---|
| **Crear** | Valida los datos de tu factura, construye el XML del SRI, lo firma con XAdES-BES, y guarda el comprobante firmado |
| **Enviar** | Envía el XML firmado al servicio SOAP del SRI |
| **Autorizar** | Consulta al SRI el resultado de la autorización; si es exitoso, envía un correo al comprador con el PDF del RIDE y el XML adjuntos |
| **Reconstruir** | Corrige y vuelve a firmar un comprobante rechazado sin cambiar su clave de acceso ni su número secuencial |

## Entrega de eventos

Registra una URL de callback HTTPS para recibir eventos casi en tiempo real — autorizaciones de comprobantes, alertas de expiración de certificados, y más. La API firma cada solicitud saliente con HMAC-SHA256 para que tu servidor pueda verificar su autenticidad.

```
POST /v1/webhooks    ← registra tu URL
```

Si no puedes exponer un endpoint público, sondea (poll) `GET /v1/notifications?sinceId=<id>` como alternativa. Consulta [Webhooks](endpoints/webhooks.md) y [Notificaciones](endpoints/notifications.md) para más detalles.

## URL base

Todos los endpoints tienen el prefijo `/v1`.

```
https://api.comprobify.com/v1
```

## Autenticación

Las llaves API están vinculadas al tenant — una sola llave puede operar sobre cada sucursal de tu cuenta. Los endpoints de comprobantes requieren tanto la llave Bearer como un encabezado `X-Issuer-Id` que nombra la sucursal destino:

```
Authorization: Bearer <api-key>
X-Issuer-Id: <issuer-id>
```

Los endpoints de gestión de emisores y de llaves solo necesitan la llave Bearer.

Consulta [Primeros Pasos](getting-started.md) para más detalles sobre el modelo de llaves, múltiples sucursales, y la generación de llaves con nombre por integración.

## Formato de respuesta

Las respuestas exitosas devuelven `200` o `201` con un cuerpo JSON. Las respuestas de error siguen [RFC 7807 Problem Details](errors/index.md) — cada error tiene un campo `code` estable que puedes usar para localización.
