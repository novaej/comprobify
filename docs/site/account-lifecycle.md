# Tu cuenta y la aplicación web

Crear tu cuenta, verificar tu correo, recuperar el acceso, aceptar los acuerdos legales y pasar a producción se hacen **en la aplicación web de Comprobify**, no por API. Esta página explica cómo funciona cada paso y qué esperar. Para pagar tu suscripción, ver [Tu suscripción y cómo pagarla](paying-your-subscription.md).

::: tip ¿Por qué no por API?
Estas acciones están reservadas a la aplicación web: una llamada directa a la API recibe `403 INTERNAL_SERVICE_ONLY`. Es intencional. Cada RUC solo puede registrarse una vez, el registro es un flujo guiado que requiere tu certificado `.p12`, la aceptación de los acuerdos legales debe quedar registrada como una acción tuya, y la llave interna de tu cuenta nunca se expone.
:::

## Crear tu cuenta

Regístrate en la aplicación web con tu RUC, los datos de tu emisor y tu certificado de firma electrónica `.p12` (formatos **BANCO CENTRAL** y **SECURITY DATA**). Opcionalmente puedes subir el logo de tu negocio (PNG, JPEG o GIF, hasta 500 KB), que aparece en el encabezado de tus RIDE.

Al terminar tienes:

- Un emisor (sucursal y punto de emisión), con tu certificado guardado cifrado.
- Una llave de sandbox que la aplicación web usa internamente para operar tu panel. **Nunca se te muestra.**
- El plan **FREE**. Todos tus comprobantes se envían al ambiente de pruebas del SRI hasta que pases a producción, y las pruebas en sandbox no consumen tu cuota.

Cada RUC solo puede registrarse una vez. Si ya tienes una cuenta, usa la recuperación (más abajo).

## Verificar tu correo

La aplicación web te envía un correo a la dirección con la que te registraste, con un enlace a su propia página de verificación — haz clic ahí para activar tu cuenta. El enlace vence, por defecto, a las 24 horas.

Si nunca lo recibiste o el enlace venció, pide uno nuevo desde la aplicación web (se puede reenviar una vez por minuto).

Hasta que verifiques tu correo puedes emitir comprobantes en sandbox, pero **no puedes** crear sucursales adicionales, generar llaves, iniciar una suscripción ni pasar a producción. Si intentas alguna de esas acciones recibes `403 EMAIL_VERIFICATION_REQUIRED`.

## Recuperar tu cuenta

Si la aplicación web muestra tu cuenta como no vinculada, usa su flujo de recuperación: sube el mismo certificado `.p12` con el que te registraste. Si coincide, tu cuenta se vuelve a vincular. Por seguridad:

- **Se revocan todas las llaves activas del ambiente actual** (sandbox o producción) y se emite una llave interna nueva para la aplicación web. Si tenías llaves con nombre para tus integraciones (Starter en adelante), dejan de funcionar — genera nuevas desde el panel.
- Tu cuenta vuelve al estado de correo pendiente de verificar y recibes un correo nuevo. Hasta que lo confirmes rigen las mismas restricciones de arriba. La emisión en sandbox sigue funcionando.

Si tu cuenta ya estaba vinculada y solo quieres confirmar que el certificado es el correcto, la aplicación web lo detecta y no toca tus llaves ni tu estado.

## Aceptar los acuerdos legales

Al registrarte se generan tus documentos personalizados — **Términos y Condiciones**, **Política de Privacidad** y **Acuerdo de Procesamiento de Datos (DPA)** — con la razón social y el RUC de tu negocio. Los revisas y los aceptas en la aplicación web, que registra quién aceptó, cuándo y desde dónde.

- Aceptarlos es requisito para pasar a producción.
- Cuando Comprobify publica una versión nueva de un documento, la aplicación web te lo indica y debes aceptarla de nuevo. El historial de versiones que aceptaste se conserva.
- Si el operador tiene desactivados los documentos legales en el despliegue en que estás, no se te pide aceptar nada y la promoción no lo exige.

## Pasar a producción

Después de verificar tu correo, aceptar los acuerdos y probar tu integración en sandbox, promueve tu cuenta desde la aplicación web. La promoción es de **una sola dirección** — no hay vuelta atrás al sandbox. Al tener éxito:

- **Todas tus sucursales pasan a producción a la vez** — no existe la promoción por sucursal. Puedes indicar el número secuencial inicial de cada emisor y tipo de comprobante; los que no indiques empiezan en `1`.
- **Todas las llaves de sandbox activas se revocan** y se crea una llave de producción equivalente por cada una, con la misma etiqueta.
- La aplicación web te muestra **una sola vez** el texto de cada llave de producción correspondiente a una llave con nombre que hayas creado — **cópialas en ese momento** y entrégalas a la integración que usaba la llave de sandbox con la misma etiqueta. Después no se vuelven a mostrar; si pierdes una, genera otra desde el panel y revoca la anterior. La llave interna de tu cuenta nunca se muestra.
- Todos los comprobantes posteriores, de cualquier sucursal, se envían al ambiente de **producción** del SRI (`ambiente = 2`) y cuentan contra tu cuota.

Al promover también puedes elegir un plan de pago; la promoción nunca espera al pago. Si tu suscripción ya estaba en curso, se aprovecha, y si estaba activa su período de facturación se reinicia en la fecha de promoción. Ver [Tu suscripción y cómo pagarla](paying-your-subscription.md).

## Si ves `INTERNAL_SERVICE_ONLY`

Una llamada tuya llegó a una acción reservada a la aplicación web: crear la cuenta, verificar el correo, recuperarla, aceptar los acuerdos legales, pasar a producción, o gestionar tu suscripción y tus pagos. Hazlo desde la aplicación web; la API no ofrece una forma directa de hacerlo, y no hay nada que configurar de tu lado.

Para todo lo demás — emitir y consultar comprobantes, gestionar emisores, llaves y webhooks — sí usas la API directamente. Ver [Primeros Pasos](getting-started.md).
