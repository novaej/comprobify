# Endpoints

Los endpoints de comprobantes requieren `Authorization: Bearer <api-key>` **y** `X-Issuer-Id: <issuer-id>`. La configuración del tenant, la gestión de emisores y la gestión de llaves solo requieren `Authorization: Bearer <api-key>`. El registro y la verificación de correo son públicos.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

## Registro (público)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/register` | Autoservicio: crea tenant + emisor + llave API de sandbox. Solo para cuentas nuevas — si el correo ya existe, rechaza con `409 CONFLICT` (usa `/v1/recover` en su lugar). |
| `POST` | `/v1/recover` | Recupera el acceso a una cuenta existente con el mismo certificado P12 — revoca y reemite la llave del entorno actual solo si el certificado coincide con el archivado |
| `GET` | `/v1/verify-email` | Verifica el correo con el token del correo de registro |
| `POST` | `/v1/resend-verification` | Reenvía el correo de verificación (regenera el token) |

## Acuerdos (público)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/agreements` | Lista la versión publicada actual de cada tipo de documento (TERMS, PRIVACY, DPA) — lee `version` de aquí y pásalo como `termsVersion` al registrarte |
| `GET` | `/v1/agreements/:type` | Obtiene el documento actual renderizado como HTML — insértalo en un modal o página de tu UI de registro |

## Planes (público)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/tiers` | Catálogo completo de planes de suscripción — cuota, precio mensual/anual, tarifa de excedente, tipos de comprobante, límites |

## Pagos (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `PATCH` | `/v1/payments/:id/proof` | Sube el comprobante de una transferencia bancaria SPI para un pago de suscripción pendiente — hasta 5 archivos por solicitud, nunca se sobrescribe lo ya subido. Un pago `REJECTED` puede reenviarse; solo `VERIFIED` bloquea nuevas subidas. |
| `GET` | `/v1/payments/:id/proofs` | Lista todos los archivos de comprobante activos subidos para un pago |
| `GET` | `/v1/payments/:id/proofs/:proofId` | Descarga un archivo de comprobante específico |
| `DELETE` | `/v1/payments/:id/proofs/:proofId` | Elimina (soft-delete) un archivo de comprobante de tu propia vista (tu proveedor aún puede verlo) |

## Suscripciones (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/v1/subscriptions` | Inicia una suscripción paga para el tenant autenticado — funciona en sandbox o después de la promoción, requiere correo verificado |
| `GET` | `/v1/subscriptions/me` | Historial completo de suscripción/pagos, del más reciente al más antiguo, con `rejection_reason_code` cuando aplica — las revisiones de pago y las renovaciones también disparan notificaciones, pero la activación en sí no, así que esta sigue siendo la forma en que un tenant consulta su estado |
| `POST` | `/v1/subscriptions/change-tier` | Sube de plan (inmediato, pago prorrateado) o baja de plan (programado, sin pago) una suscripción `ACTIVE` existente — usa `DELETE` abajo para cancelar por completo |
| `DELETE` | `/v1/subscriptions` | Programa una cancelación al final del período — baja el tenant a FREE sin reembolso cuando pasa `current_period_end` |

## Tenants (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/tenants/me` | Resuelve el tenant (id, correo, plan, estado, cuota, entorno, aceptación de acuerdos) para la llave API autenticada |
| `PATCH` | `/v1/tenants/language` | Actualiza el idioma preferido para los correos salientes |
| `POST` | `/v1/tenants/promote` | Promueve el tenant a producción — revoca todas las llaves de sandbox y crea llaves de producción equivalentes |
| `GET` | `/v1/tenants/agreements` | Verifica si algún acuerdo necesita aceptación — devuelve qué tipos están desactualizados. Genera instancias PENDING de forma diferida para cualquier versión de plantilla nueva; los integradores externos deberían consultar esto periódicamente |
| `POST` | `/v1/tenants/agreements` | Acepta todos los acuerdos PENDING — requerido antes de promover a producción |
| `GET` | `/v1/tenants/agreements/history` | Lista todas las instancias de acuerdo personalizadas del tenant, con estado y marcas de tiempo de aceptación |
| `GET` | `/v1/tenants/agreements/:type` | Renderiza el documento personalizado del tenant como HTML — incluye su razón social/RUC y las fechas al momento en que se creó la cuenta |
| `GET` | `/v1/tenants/events` | Bitácora de auditoría completa a nivel de tenant (verificación, suscripción, pagos, historial de cambios de plan/intervalo de facturación), en orden cronológico |

## Emisores (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/issuers` | Lista todos los emisores activos (sucursales / puntos de emisión) del tenant |
| `POST` | `/v1/issuers` | Crea una nueva sucursal o punto de emisión — hereda el certificado de un emisor existente del tenant. NO genera una nueva llave API. |
| `GET` | `/v1/issuers/:id` | Obtiene el perfil de un emisor (nombre, RUC, vencimiento del certificado) |
| `PATCH` | `/v1/issuers/:id` | Edita `tradeName` y/o `branchAddress` |
| `DELETE` | `/v1/issuers/:id` | Elimina (soft-delete) un emisor (bloqueado si es el último o si ya emitió comprobantes) |
| `PATCH` | `/v1/issuers/:id/activate` | Reactiva un emisor eliminado (soft-delete) (vuelve a verificar los límites de sucursales/puntos de emisión del plan) |
| `PATCH` | `/v1/issuers/:id/logo` | Sube o reemplaza el logo del emisor mostrado en los PDF RIDE (PNG/JPEG/GIF, máx. 500 KB) |
| `PATCH` | `/v1/issuers/:id/certificate` | Renueva el certificado P12 del emisor (llave privada + certificado) — por ejemplo, cuando ha vencido |
| `GET` | `/v1/issuers/:id/document-types` | Lista los tipos de comprobante activos para el emisor |
| `POST` | `/v1/issuers/:id/document-types` | Habilita un tipo de comprobante para el emisor |
| `DELETE` | `/v1/issuers/:id/document-types/:code` | Deshabilita un tipo de comprobante para el emisor |
| `GET` | `/v1/issuers/:id/sequentials` | Consulta los números secuenciales actuales y siguientes por tipo de comprobante, por entorno |
| `PATCH` | `/v1/issuers/:id/sequentials/:documentType` | Establece manualmente el siguiente número secuencial para un tipo de comprobante/entorno |

## Llaves API (autenticado)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/keys` | Lista todas las llaves activas del tenant (etiqueta, entorno, created_at) |
| `POST` | `/v1/keys` | Genera una nueva llave con nombre (`label`, `environment` opcional) |
| `DELETE` | `/v1/keys/:id` | Revoca una llave API. No se puede revocar la llave usada en la solicitud actual. |

## Comprobantes

Cada endpoint de comprobantes requiere tanto `Authorization: Bearer <key>` como `X-Issuer-Id: <issuer-id>`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/v1/documents` | Lista comprobantes con filtros y paginación |
| `GET` | `/v1/documents/stats` | Estadísticas de comprobantes por tipo del mes actual + cantidad que requiere atención |
| `POST` | `/v1/documents` | Crea y firma un comprobante — factura ([Create Invoice](create-invoice.md)) o nota de crédito ([Create Credit Note](create-credit-note.md)), seleccionado mediante `documentType` |
| `GET` | `/v1/documents/:accessKey` | Obtiene un comprobante por clave de acceso |
| `POST` | `/v1/documents/:accessKey/send` | Encola el envío al SRI ([Send to SRI](send-to-sri.md) — devuelve 202, asíncrono) |
| `GET` | `/v1/documents/:accessKey/authorize` | Encola una verificación de autorización ante el SRI ([Check Authorization](check-authorization.md) — devuelve 202, asíncrono) |
| `POST` | `/v1/documents/:accessKey/rebuild` | Reconstruye y vuelve a firmar un comprobante rechazado |
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
