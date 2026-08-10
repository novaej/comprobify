# Política de Privacidad — Comprobify

Esta Política de Privacidad describe cómo **{{operador.nombre}}**, persona natural con RUC **{{operador.ruc}}**, titular de la plataforma Comprobify ("Comprobify", "nosotros") trata los datos personales en el contexto de la prestación de la API de facturación electrónica, en cumplimiento de la Ley Orgánica de Protección de Datos Personales de la República del Ecuador (la "LOPDP").

## 1. Roles: quién es responsable de qué

Es importante distinguir dos roles, porque determinan quién decide qué se hace con los datos:

- **El Cliente (la persona natural o jurídica que usa Comprobify) es el Responsable del Tratamiento** de los datos de sus propios compradores/clientes finales. Es el Cliente quien decide qué datos de comprador se incluyen en cada comprobante y con qué finalidad.
- **Comprobify actúa como Encargado del Tratamiento** respecto de esos datos: los procesamos únicamente para generar, firmar y transmitir comprobantes electrónicos por instrucción del Cliente, y no los utilizamos para ningún fin propio (marketing, perfilamiento, venta a terceros, etc.), salvo cuando sea estrictamente necesario para la seguridad del Servicio, prevención de fraude, cumplimiento de obligaciones legales, o resolución de incidencias.

Para los datos del propio Cliente (su cuenta, su correo, su certificado de firma), Comprobify es el Responsable del Tratamiento.

## 2. Qué datos recopilamos

| Dato | De quién | Por qué |
|---|---|---|
| Correo electrónico, RUC, razón social del Cliente | Del Cliente (titular de la cuenta) | Identificación de la cuenta, comunicaciones operativas (verificación, facturación, alertas) |
| Datos contenidos en los comprobantes electrónicos, incluyendo RUC/cédula, nombre, dirección, correo electrónico, teléfono, y demás campos exigidos por la normativa del SRI según el tipo de comprobante | Del Cliente, por instrucción suya | Requisito legal del SRI para la emisión válida de comprobantes electrónicos |
| Clave privada de firma (cifrada con AES-256-GCM) y certificado digital (.p12) | Del Cliente | Almacenados únicamente para prestar el servicio de firma electrónica (XAdES-BES) solicitado por el Cliente, requerido por el SRI |
| Dirección IP y user-agent del Cliente | Del Cliente | Evidencia de aceptación al aceptar los Términos de Servicio, la Política de Privacidad o el DPA (ver sección de Registros) |
| Comprobante de pago (transferencia bancaria) | Del Cliente | Verificación manual de pagos de suscripción |

Los datos contenidos en el comprobante incluyen, cuando el Cliente los utiliza, los denominados "Campos Adicionales" (a nivel de comprobante) y "Detalles Adicionales" (a nivel de cada ítem), previstos por el esquema del SRI como campos de texto libre — su contenido es determinado libremente por el Cliente y puede incluir información adicional a la exigida por la normativa del SRI.

Cuando el Cliente utiliza el Servicio exclusivamente a través de la API, no recopilamos datos de comprador más allá de los exigidos por la normativa aplicable del SRI para el tipo de comprobante electrónico, la cual puede ser actualizada por el Servicio de Rentas Internas (SRI) o la autoridad tributaria competente.

**Datos adicionales si el Cliente utiliza la interfaz web (comprobify-web).** Cuando el Cliente utiliza la interfaz web del Servicio, Comprobify además almacena el nombre, correo electrónico, contraseña (almacenada como hash, nunca en texto plano) y rol de cada usuario que el Cliente invita a acceder a la cuenta, con el fin de gestionar el acceso y los permisos dentro de la interfaz. Comprobify también puede almacenar otros datos que el Cliente decida ingresar para facilitar su uso del Servicio — por ejemplo, catálogos de compradores (con fines de reutilización en futuros comprobantes) y catálogos de productos o servicios propios del Cliente —, así como otra información funcionalmente similar que se incorpore conforme evolucione el Servicio. Esta funcionalidad no se activa si el Cliente utiliza el Servicio únicamente a través de la API; en ese caso, Comprobify no almacena datos de comprador ni de usuarios individuales más allá de los indicados en la tabla anterior.

## 3. Base legal y finalidad

Respecto de los datos del propio Cliente, el tratamiento se realiza para la ejecución de los Términos de Servicio entre Comprobify y el Cliente, que constituyen el contrato de servicio bajo el cual se presta el Servicio. Respecto de los datos del comprador, el tratamiento se realiza por instrucción directa del Cliente en su calidad de Responsable del Tratamiento, con la finalidad exclusiva de generar y transmitir comprobantes electrónicos válidos ante el SRI.

## 4. Con quién compartimos datos (subencargados)

Los datos se almacenan y procesan utilizando los siguientes proveedores, cada uno actuando como subencargado del tratamiento respecto de los datos que procesa por cuenta de Comprobify, conforme a sus propios términos de servicio y compromisos de confidencialidad y seguridad:

- **DigitalOcean** — hosting de la API (todos los Clientes).
- **DigitalOcean Managed Postgres** — base de datos PostgreSQL, utilizada tanto por la API como por la interfaz web del Servicio (comprobify-web) cuando el Cliente la utiliza.
- **DigitalOcean App Platform** — hosting de la interfaz web del Servicio (comprobify-web) (solo Clientes que utilizan la interfaz web).
- **Mailgun** — envío de correos transaccionales (verificación de cuenta, RIDE/PDF de comprobantes autorizados, notificaciones) (todos los Clientes).
- **Sentry** — monitoreo de errores (configurado para minimizar el tratamiento de datos personales) (todos los Clientes).
- **Betterstack** — plataforma de registro (logging) para monitoreo operativo y diagnóstico de errores; puede incluir la dirección IP de cada solicitud a la API, conforme a lo descrito en la sección 6 (todos los Clientes).
- **CloudAMQP** — enrutamiento de mensajes para el procesamiento asíncrono de comprobantes electrónicos; los mensajes contienen únicamente identificadores del comprobante, sin datos del comprador (todos los Clientes).
- **SRI (Servicio de Rentas Internas)** — autoridad tributaria ecuatoriana receptora obligatoria por mandato legal; la transmisión de comprobantes electrónicos es exigida por la normativa tributaria aplicable (todos los Clientes).

Los subencargados marcados como aplicables únicamente a la interfaz web solo tratan datos del Cliente si este utiliza comprobify-web; un Cliente que utiliza el Servicio exclusivamente a través de la API no está sujeto a dichos subencargados.

Algunos de estos proveedores pueden procesar datos en servidores ubicados fuera del Ecuador. Dichas transferencias se realizan únicamente para la prestación del Servicio y bajo los compromisos de confidencialidad y seguridad propios de cada proveedor.

No vendemos ni compartimos datos personales con terceros para fines comerciales o publicitarios.

Esta lista de proveedores puede actualizarse conforme evolucione la infraestructura del Servicio, garantizando en todo momento un nivel adecuado de protección de datos personales.

## 5. Medidas de seguridad

- **Aislamiento de los datos de comprobantes a nivel de base de datos** mediante Row-Level Security (RLS) de PostgreSQL — las tablas que contienen los comprobantes electrónicos y sus líneas, eventos y secuenciales están restringidas por emisor directamente en el motor de base de datos, no solo por la lógica de la aplicación. El resto de los datos de la cuenta (suscripciones, pagos, notificaciones, API keys, eventos de cuenta) se aíslan por filtrado explícito por cuenta en la capa de aplicación.
- **Cifrado AES-256-GCM** de la clave privada de firma; la clave de cifrado se gestiona fuera de la base de datos.
- **TLS** en todas las comunicaciones con la API.
- **API keys almacenadas únicamente como hash (SHA-256)** — la API key en texto plano nunca se guarda en el sistema; solo se conserva su huella criptográfica, de modo que una filtración de la base de datos no expone API keys utilizables.
- **Acceso administrativo** restringido mediante mecanismos de autenticación independientes de las credenciales de los Clientes.
- **Recuperación de cuenta verificada por certificado** — una nueva API key solo se emite si el certificado digital presentado coincide con el certificado ya registrado para la cuenta; conocer el correo electrónico de la cuenta, por sí solo, no es suficiente para obtener acceso.
- **Diseño anti-enumeración** en los flujos de recuperación de cuenta y reenvío de verificación — una solicitud con un correo no registrado, sin emisor asociado, o con un certificado que no coincide recibe la misma respuesta genérica, de modo que estos flujos no puedan usarse para confirmar si un correo existe en el sistema.
- **Firma de los webhooks salientes (HMAC-SHA256)** — cada notificación enviada a los endpoints de webhook configurados por el Cliente incluye una firma que le permite verificar que el contenido proviene efectivamente de Comprobify y no ha sido alterado en tránsito.
- **Limitación de tasa (rate limiting)** por API key, según el plan de suscripción del Cliente, como medida adicional contra el abuso del Servicio.
- La cuenta de base de datos utilizada por la aplicación no tiene privilegios de superusuario, y las políticas de RLS están diseñadas para impedir su elusión desde la capa de aplicación.

## 6. Registros (logs)

Comprobify mantiene un registro de auditoría de los eventos relevantes del ciclo de vida de cada comprobante y de la cuenta del Cliente (creación, envío, autorización, cambios de estado, entre otros), con la finalidad de garantizar la seguridad del Servicio, diagnosticar errores y mantener la trazabilidad de las operaciones.

La dirección IP y el user-agent del Cliente se registran al momento de aceptar los Términos de Servicio, la Política de Privacidad o el DPA, como evidencia de dicha aceptación. Adicionalmente, con fines de seguridad y diagnóstico operativo, la dirección IP de cada solicitud individual a la API se incluye en los registros técnicos del Servicio, los cuales se conservan durante un período máximo de tres (3) días, transcurrido el cual se eliminan de forma automática.

Comprobify también utiliza contadores temporales en memoria (Redis), indexados por dirección IP o por identificador de solicitud, con fines de limitación de tasa (rate limiting) y detección de intentos repetidos de acceso no autorizado. Estos contadores se eliminan automáticamente en cuestión de minutos y no constituyen un registro histórico.

## 7. Cookies y tecnologías similares

Esta política cubre la API. Cuando el Cliente utiliza el sitio web y el panel de administración del Servicio (comprobify-web), estos utilizan cookies técnicas necesarias para mantener la sesión del usuario autenticado, recordar el emisor activo seleccionado, garantizar la seguridad, y mejorar el funcionamiento del Servicio. Comprobify no utiliza cookies con fines publicitarios ni de seguimiento de terceros, salvo que se indique expresamente en el momento correspondiente.

## 8. Retención de datos

Comprobify almacena los datos relacionados con comprobantes electrónicos emitidos a través del Servicio (facturas, notas de crédito y documentos similares) y los metadatos necesarios para su autorización por el SRI. Cuando el Cliente utiliza la interfaz web del Servicio (comprobify-web), Comprobify también almacena, de forma independiente al comprobante, los datos adicionales descritos en la sección 2 (catálogo de compradores y demás datos que el Cliente decida ingresar mediante esa interfaz) — funcionalidad que no se activa si el Cliente utiliza el Servicio únicamente a través de la API. Fuera de estos dos contextos, Comprobify no almacena datos de compradores.

Los comprobantes electrónicos y su historial de autorización, firma y transmisión están sujetos a los plazos de conservación establecidos por la normativa tributaria ecuatoriana — en particular el Código Tributario y el Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios —, que exigen conservar los documentos tributarios durante el período de prescripción de las obligaciones tributarias. **Durante este período — que conforme al Art. 55 del Código Tributario es de cinco (5) años para los casos ordinarios y de siete (7) años cuando la declaración no fue presentada o fue presentada de forma incompleta; se recomienda conservar durante el plazo mayor como medida prudente —, Comprobify no eliminará ni permitirá la eliminación de dichos datos, incluso ante una solicitud de supresión.** El derecho de supresión reconocido por la LOPDP no es aplicable cuando la conservación es necesaria para el cumplimiento de una obligación legal (Art. 15 LOPDP).

**El catálogo de compradores y el catálogo de productos o servicios (cuando aplican) no están sujetos a esta limitación.** A diferencia de los datos ya incorporados en un comprobante autorizado, una entrada de estos catálogos no constituye por sí misma un documento tributario — el Cliente puede eliminarla directamente desde la interfaz web en cualquier momento, sin las restricciones aplicables a los datos de comprobantes ya autorizados.

Para los datos de la cuenta del Cliente (correo electrónico, metadatos de registro, historial de pagos) — y, cuando el Cliente utiliza comprobify-web, los datos de los usuarios individuales invitados a esa interfaz — que no formen parte de un comprobante electrónico autorizado por el SRI, Comprobify atenderá solicitudes de supresión una vez terminada la relación con Comprobify, siempre que no existan obligaciones legales que requieran su conservación.

Actualmente el sistema no implementa un mecanismo de eliminación definitiva de comprobantes electrónicos ni de su historial de auditoría y cumplimiento normativo; únicamente admite la desactivación lógica de recursos como emisores.

## 9. Derechos del titular de los datos

Bajo la LOPDP, los compradores cuyos datos constan en un comprobante pueden ejercer sus derechos de acceso, rectificación, actualización, eliminación (cuando proceda), oposición y portabilidad (si aplica), **directamente ante el Cliente** (Responsable del Tratamiento), quien decidió incluir esos datos. Comprobify, como Encargado, colaborará con el Cliente para atender dichas solicitudes en la medida técnicamente posible. **El derecho de eliminación no aplica a los datos contenidos en comprobantes electrónicos autorizados por el SRI durante el período de conservación obligatorio establecido por la normativa tributaria ecuatoriana (ver sección 8).**

El Cliente, respecto de los datos de su propia cuenta (correo, certificado, historial de pagos), puede ejercer los mismos derechos señalados anteriormente directamente ante Comprobify, escribiendo a `{{soporte.email}}`.

Cuando el Cliente utiliza comprobify-web, cada usuario individual que invita a esa interfaz puede ejercer los mismos derechos respecto de sus propios datos (nombre, correo electrónico, contraseña). El acceso y la rectificación de su nombre y contraseña están disponibles directamente desde su cuenta en comprobify-web; cualquier otra solicitud puede dirigirse a `{{soporte.email}}`. Esta funcionalidad no aplica si el Cliente utiliza el Servicio únicamente a través de la API.

## 10. Cambios a esta política

Publicaremos cualquier cambio material en esta página con una nueva versión. Cuando las modificaciones sean sustanciales y la legislación aplicable así lo requiera, Comprobify podrá solicitar una nueva aceptación antes de continuar utilizando el Servicio.

## 11. Contacto

`{{operador.nombre}}` — RUC `{{operador.ruc}}` — {{operador.domicilio}} — `{{soporte.email}}`
