# Tu suscripción y cómo pagarla

Esta página explica cómo funciona tu suscripción a Comprobify y cómo pagarla. **Todo esto se gestiona desde la aplicación web de Comprobify** — no necesitas integrar nada por API para pagar, cambiar de plan o cancelar.

::: tip Esto es cómo nos pagas a nosotros
No confundir con la emisión de comprobantes. Tu suscripción es lo que pagas a Comprobify por usar el servicio; los comprobantes que emites a *tus* clientes son otra cosa completamente distinta y sí se gestionan por API (ver [Comprobantes](endpoints/create-invoice.md)).
:::

## Elegir un plan

Los planes disponibles, con su cuota mensual base de comprobantes, precios y límites, se consultan y eligen desde la aplicación web de Comprobify — no hay un endpoint público pensado para que integradores externos lean el catálogo de planes.

La facturación puede ser **mensual** o **anual**. El plan anual equivale a 10 meses (dos meses gratis). **La forma en que se consume tu cuota depende de esto:** en facturación mensual, la cuota se renueva cada mes; en facturación anual, recibes de una sola vez el equivalente a 12 meses de cuota (cifra mensual × 12) para todo el año, consumible de forma pareja o despareja — no se reinicia mes a mes. El plan Enterprise no tiene cuota: es ilimitado en cualquier modalidad de pago.

## Dos formas de pagar

### Tarjeta

Pagas con tarjeta desde la aplicación web y **tu plan queda activo en segundos**. No hay comprobante que subir ni revisión que esperar.

Detrás de escena el cobro se procesa con Payphone. Tras completar el formulario de pago serás redirigido de vuelta a Comprobify, que confirma el cobro automáticamente. Si cierras el navegador en ese momento, el cobro se revierte solo y el dinero vuelve a tu tarjeta — vuelve a intentarlo cuando quieras.

Si tu tarjeta es rechazada no se cobra nada y puedes reintentar de inmediato.

Payphone no procesa cobros menores a **$1,00**. Es poco frecuente — solo ocurre en un cambio de plan prorrateado con muy poco tiempo restante del período — pero en ese caso la opción de tarjeta no estará disponible y deberás pagar por transferencia.

### Transferencia bancaria (SPI)

La aplicación web te muestra los datos de la cuenta a la que transferir, junto con un código de referencia corto para ese pago. Inclúyelo en la descripción de tu transferencia si tu banco lo permite — así tu proveedor puede identificarla más rápido, incluso antes de que revise el comprobante. Una vez hecha la transferencia, subes el comprobante (imagen o PDF) junto con el número de referencia de tu banco.

Tu proveedor revisa el comprobante contra el banco y lo aprueba o lo rechaza. **Recibirás una notificación y un correo en cuanto registre su decisión** (ver [Notificaciones](endpoints/notifications.md)). Si se aprueba, tu plan se activa en ese mismo momento.

Si se rechaza, el correo indica el motivo (por ejemplo, que el monto no coincide o que la transferencia aún no aparece). Puedes subir un comprobante nuevo para el mismo pago sin empezar de cero — nada de lo ya subido se pierde.

## Qué pasa después de pagar

Tu plan y tu cuota se aplican **en el momento en que el pago se verifica**. No hay un segundo paso que esperar.

Tu proveedor emite después la factura correspondiente por ese pago. Eso es una obligación suya y ocurre por separado: **nunca retiene la activación de tu plan**.

Puedes confirmar el resultado en la aplicación web, o mediante [`GET /v1/tenants/me`](endpoints/tenant-me.md), que muestra tu plan y cuota actuales.

## Renovaciones

Una suscripción activa se renueva al final de cada período de facturación.

- **~7 días antes** del vencimiento recibes una notificación `SUBSCRIPTION_RENEWAL_DUE` y un correo. Ya hay un pago de renovación abierto y listo para cubrir, con tarjeta o transferencia.
- Si el período vence sin pago, hay un **período de gracia de ~7 días**. A mitad de ese período recibes un segundo aviso, más urgente.
- Si la gracia se agota sin pago, tu cuenta baja al plan FREE y pasa a estado `PAST_DUE`.

`PAST_DUE` **se resuelve solo**: inicias una suscripción nueva desde la aplicación web, la pagas, y tu cuenta vuelve a `ACTIVE` de inmediato. No necesitas contactar a soporte. Es distinto de `SUSPENDED`, que sí es una acción manual del proveedor.

## Cambiar de plan

Desde la aplicación web puedes subir o bajar de plan, y cambiar entre facturación mensual y anual. Las reglas:

| Cambio | Cuándo aplica | Qué pagas |
|---|---|---|
| **Subir de plan** (mismo intervalo) | De inmediato, al pagarse | Solo la diferencia, prorrateada por el tiempo que queda del período actual |
| **Bajar de plan** (mismo intervalo) | Al final del período actual | Nada — el período actual ya está pagado al plan superior |
| **Cambiar mensual ↔ anual** | Al final del período actual | Precio completo del nuevo plan+intervalo, sin prorrateo |

Solo puede haber un cambio pendiente a la vez. El historial completo de cambios de plan a lo largo del tiempo está en [Historial de eventos del tenant](endpoints/tenant-events.md).

## Usuarios adicionales

Cada plan incluye un número determinado de usuarios del panel. Si necesitas más, puedes comprar usuarios adicionales desde la aplicación web a un precio fijo por usuario (el mismo sin importar tu plan) — visible ahí junto al resto del catálogo.

| Cambio | Cuándo aplica | Qué pagas |
|---|---|---|
| **Agregar un usuario** | De inmediato, al pagarse | Prorrateado por el tiempo que queda del período actual |
| **Quitar un usuario** | Al final del período actual | Nada — el período actual ya está pagado al número superior |

Una vez que tienes usuarios adicionales, su costo se incluye en tu renovación de plan habitual — **un solo pago, no dos** — así que no hay nada extra que rastrear por separado. Cambiar tu intervalo de facturación (mensual ↔ anual) también reprecia los usuarios adicionales activos al nuevo intervalo, como parte de ese mismo cambio.

## Cancelar

Puedes programar una cancelación desde la aplicación web. Tu plan sigue funcionando normalmente hasta el final del período que ya pagaste; al llegar esa fecha, la cuenta baja a FREE. No hay reembolso por el tiempo restante.

## Protección de precios

Si Comprobify cambia el precio de tu plan — o el precio del complemento de usuarios adicionales —, recibes un aviso con **al menos 30 días de anticipación** (notificación `PRICE_CHANGE_ANNOUNCED` y correo — este aviso no se puede desactivar). Cualquier renovación que venza antes de la fecha efectiva del nuevo precio se cobra al precio anterior, automáticamente.

## Cómo enterarte de todo esto por API

Aunque el pago se hace desde la aplicación web, sí puedes recibir los eventos de facturación programáticamente:

- [Notificaciones](endpoints/notifications.md) — `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_RENEWAL_DUE`, `SUBSCRIPTION_PAST_DUE_WARNING`, `SUBSCRIPTION_EXPIRED`, `PRICE_CHANGE_ANNOUNCED`, consultables o entregadas por [webhook](endpoints/webhooks.md).
- [`GET /v1/tenants/me`](endpoints/tenant-me.md) — tu plan, cuota, usuarios adicionales y estado de cuenta actuales.
- [Historial de eventos del tenant](endpoints/tenant-events.md) — la secuencia completa de lo que ha pasado con tu cuenta.
