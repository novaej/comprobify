# Endpoints

Los endpoints de comprobantes requieren `Authorization: Bearer <api-key>` **y** `X-Issuer-Id: <issuer-id>`. La configuración del tenant, la gestión de emisores y la gestión de llaves solo requieren `Authorization: Bearer <api-key>`. La creación, recuperación y activación de cuentas están restringidas a la aplicación web de Comprobify — ver abajo.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

## Cuenta, acuerdos legales y promoción a producción (solo aplicación web)

Crear la cuenta, verificar el correo, recuperar el acceso, aceptar los acuerdos legales y pasar a producción se hacen en la aplicación web de Comprobify, no por API — ver [Tu cuenta y la aplicación web](../account-lifecycle.md).

> **¿Cómo pagas tu suscripción?** Desde la aplicación web — con tarjeta o transferencia bancaria, incluyendo consultar los planes y precios vigentes. No hay endpoints públicos que integrar para nada de esto; ver [Tu suscripción y cómo pagarla](../paying-your-subscription.md).

## Tenants (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/tenants/me` | Resuelve el tenant (id, correo, plan, estado, cuota, entorno, aceptación de acuerdos) para la API key autenticada |
| `PATCH` | `/v1/tenants/language` | Actualiza el idioma preferido para los correos salientes |
| `GET` | `/v1/tenants/events` | Bitácora de auditoría completa a nivel de tenant (verificación, suscripción, pagos, historial de cambios de plan/intervalo de facturación), en orden cronológico |
| `POST` | `/v1/tenants/retry-failed-documents` | Recupera todos los comprobantes estancados del tenant (envío/autorización fallidos tras agotar los reintentos automáticos) — abarca todos los emisores, sin `X-Issuer-Id` ([Reintentar Todos los Comprobantes Fallidos](retry-failed-documents.md)) |

## Emisores (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/issuers` | Lista todos los emisores activos (sucursales / puntos de emisión) del tenant |
| `POST` | `/v1/issuers` | Crea una nueva sucursal o punto de emisión — hereda el certificado de un emisor existente del tenant. NO genera una nueva API key. |
| `GET` | `/v1/issuers/:id` | Obtiene el perfil de un emisor (nombre, RUC, vencimiento del certificado) |
| `PATCH` | `/v1/issuers/:id` | Edita `tradeName` y/o `branchAddress` |
| `DELETE` | `/v1/issuers/:id` | Elimina (soft-delete) un emisor (bloqueado si es el último o si ya emitió comprobantes) |
| `PATCH` | `/v1/issuers/:id/activate` | Reactiva un emisor eliminado (soft-delete) (vuelve a verificar los límites de sucursales/puntos de emisión del plan) |
| `PATCH` | `/v1/issuers/:id/can-issue` | Pausa o reanuda la creación de comprobantes nuevos en el emisor, sin desactivarlo |
| `PATCH` | `/v1/issuers/:id/logo` | Sube o reemplaza el logo del emisor mostrado en los PDF RIDE (PNG/JPEG/GIF, máx. 500 KB) |
| `PATCH` | `/v1/issuers/:id/certificate` | Renueva el certificado P12 del emisor (llave privada + certificado) — por ejemplo, cuando ha vencido |
| `GET` | `/v1/issuers/:id/document-types` | Lista los tipos de comprobante activos para el emisor |
| `POST` | `/v1/issuers/:id/document-types` | Habilita un tipo de comprobante para el emisor |
| `DELETE` | `/v1/issuers/:id/document-types/:code` | Deshabilita un tipo de comprobante para el emisor |
| `GET` | `/v1/issuers/:id/sequentials` | Consulta los números secuenciales actuales y siguientes por tipo de comprobante, por entorno |
| `PATCH` | `/v1/issuers/:id/sequentials/:documentType` | Establece manualmente el siguiente número secuencial para un tipo de comprobante/entorno |

## API keys (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/keys` | Lista todas las llaves activas del tenant (etiqueta, entorno, created_at, uso) |
| `POST` | `/v1/keys` | Genera una nueva llave con nombre (`label`, `environment` opcional) |
| `DELETE` | `/v1/keys/:id` | Revoca una API key. No se puede revocar la llave usada en la solicitud actual. |
| `GET` | `/v1/keys/:id/usage` | Serie diaria de uso de una llave, rellenada con ceros, lista para graficar |

## Comprobantes

Cada endpoint de comprobantes requiere tanto `Authorization: Bearer <key>` como `X-Issuer-Id: <issuer-id>`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/documents` | Lista comprobantes con filtros y paginación |
| `GET` | `/v1/documents/stats` | Estadísticas de comprobantes por tipo del mes actual + cantidad que requiere atención |
| `POST` | `/v1/documents` | Crea y firma un comprobante — factura ([Create Invoice](create-invoice.md)) o nota de crédito ([Create Credit Note](create-credit-note.md)), seleccionado mediante `documentType` |
| `GET` | `/v1/documents/:accessKey` | Obtiene un comprobante por clave de acceso |
| `POST` | `/v1/documents/:accessKey/send` | Encola el envío al SRI ([Send to SRI](send-to-sri.md) — devuelve 202, asíncrono) |
| `POST` | `/v1/documents/:accessKey/send/retry` | Recupera un comprobante estancado tras agotar los reintentos automáticos de envío/autorización ([Reintentar Envío/Autorización](retry-send.md) — devuelve 202, asíncrono) |
| `GET` | `/v1/documents/:accessKey/authorize` | Encola una verificación de autorización ante el SRI ([Check Authorization](check-authorization.md) — devuelve 202, asíncrono) |
| `POST` | `/v1/documents/:accessKey/rebuild` | Reconstruye y vuelve a firmar un comprobante rechazado |
| `POST` | `/v1/documents/:accessKey/void` | Anula un comprobante `AUTHORIZED` ([Anular Comprobante](void-document.md) — sincronización manual, no llama al SRI) |
| `GET` | `/v1/documents/:accessKey/ride` | Descarga el PDF RIDE |
| `GET` | `/v1/documents/:accessKey/xml` | Descarga el XML firmado |
| `GET` | `/v1/documents/:accessKey/events` | Obtiene el historial de eventos de auditoría |
| `GET` | `/v1/documents/:accessKey/sri-responses` | Resultados sin procesar de las llamadas de recepción/autorización al SRI (estado + mensajes) para este comprobante |
| `GET` | `/v1/documents/:accessKey/credit-notes` | Suma de notas de crédito `AUTHORIZED` emitidas contra este comprobante + saldo restante |
| `POST` | `/v1/documents/email-retry` | Reintenta todos los correos fallidos/pendientes (por lote) |
| `POST` | `/v1/documents/:accessKey/email-retry` | Reintenta el correo de un solo comprobante |

## Notificaciones (autenticado)

Alertas a nivel de tenant para eventos de comprobantes y estado de certificados. Proporciona `X-Issuer-Id` para filtrar por un emisor específico; omítelo para recibir notificaciones de todos tus emisores. Usa `?sinceId=<id>` para consultar de forma eficiente solo las notificaciones nuevas desde tu última solicitud.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/notifications` | Lista notificaciones activas (leídas y no leídas). `?sinceId=<id>` opcional para consultas de actualización incremental. |
| `POST` | `/v1/notifications/:id/read` | Marca una notificación como leída |
| `GET` | `/v1/notifications/preferences` | Obtiene las preferencias de tipo de notificación del tenant |
| `PATCH` | `/v1/notifications/preferences` | Habilita o deshabilita tipos de notificación |

## Webhooks (autenticado)

Registra URLs de callback HTTPS para recibir notificaciones de eventos casi en tiempo real.

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/webhooks` | Registra un nuevo endpoint de webhook (el secreto se muestra una sola vez) |
| `GET` | `/v1/webhooks` | Lista los endpoints de webhook activos (sin incluir los secretos) |
| `PATCH` | `/v1/webhooks/:id` | Actualiza la URL, las suscripciones a eventos o el indicador de activo |
| `DELETE` | `/v1/webhooks/:id` | Da de baja un endpoint (soft-delete) |

## Monitoreo

| Método | Ruta | Autenticación | Descripción |
|---|---|---|---|
| `GET` | `/health` | Ninguna | Verificación de conectividad a la base de datos para sondas de liveness |
