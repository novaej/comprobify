> **BORRADOR PARA REVISIÓN — no constituye asesoría legal.**
> Redactado a partir del funcionamiento real de la API (ver `CLAUDE.md`), no de una plantilla genérica. Requiere revisión legal antes de publicarse, especialmente en lo referente a derechos del titular bajo la LOPDP y plazos de respuesta. Reemplazar los campos entre `[corchetes]`.
>
> **Versión:** `[2026-06-28]` _(debe coincidir con el `termsVersion` enviado al registrarse y con el publicado vía `POST /v1/admin/legal-documents`)_

# Política de Privacidad — Comprobify

**Última actualización:** `[fecha]`

Esta Política de Privacidad describe cómo **[Tu nombre completo]**, persona natural con RUC **[RUC]**, titular de la plataforma Comprobify ("Comprobify", "nosotros") trata los datos personales en el contexto de la prestación de la API de facturación electrónica, en cumplimiento de la Ley Orgánica de Protección de Datos Personales de la República del Ecuador (la "LOPDP"). _(Cuando se constituya una compañía, basta con actualizar este dato.)_

## 1. Roles: quién es responsable de qué

Es importante distinguir dos roles, porque determinan quién decide qué se hace con los datos:

- **El Cliente (la empresa que usa Comprobify) es el Responsable del Tratamiento** de los datos de sus propios compradores/clientes finales. Es el Cliente quien decide qué datos de comprador se incluyen en cada comprobante y con qué finalidad.
- **Comprobify actúa como Encargado del Tratamiento** respecto de esos datos: los procesamos únicamente para generar, firmar y transmitir comprobantes electrónicos por instrucción del Cliente, y no los utilizamos para ningún fin propio (marketing, perfilamiento, venta a terceros, etc.), salvo cuando sea estrictamente necesario para la seguridad del Servicio, prevención de fraude, cumplimiento de obligaciones legales, o resolución de incidencias.

Para los datos del propio Cliente (su cuenta, su correo, su certificado de firma), Comprobify es el Responsable del Tratamiento.

## 2. Qué datos recopilamos

| Dato | De quién | Por qué |
|---|---|---|
| Correo electrónico, RUC, razón social del Cliente | Del Cliente (titular de la cuenta) | Identificación de la cuenta, comunicaciones operativas (verificación, facturación, alertas) |
| Datos contenidos en los comprobantes electrónicos, incluyendo RUC/cédula, nombre, dirección, correo electrónico, teléfono, y demás campos exigidos por la normativa del SRI según el tipo de comprobante | Del Cliente, por instrucción suya | Requisito legal del SRI para la emisión válida de comprobantes electrónicos |
| Clave privada de firma (cifrada con AES-256-GCM) y certificado digital (.p12) | Del Cliente | Almacenados únicamente para prestar el servicio de firma electrónica (XAdES-BES) solicitado por el Cliente, requerido por el SRI |
| Dirección IP, fecha, endpoint solicitado, e identificador de cuenta de cada solicitud a la API | De quien usa la API (Cliente o su integración) | Seguridad del Servicio, prevención de fraude, diagnóstico de errores y trazabilidad de operaciones (ver sección de Registros) |
| Comprobante de pago (transferencia bancaria) | Del Cliente | Verificación manual de pagos de suscripción |

No recopilamos datos de comprador más allá de los exigidos por la normativa aplicable del SRI para el tipo de comprobante electrónico, la cual puede ser actualizada por el Servicio de Rentas Internas (SRI) o la autoridad tributaria competente.

## 3. Base legal y finalidad

El tratamiento se realiza para la ejecución del contrato de servicio (estos Términos) entre Comprobify y el Cliente, y, respecto de los datos del comprador, por instrucción directa del Cliente en su calidad de Responsable del Tratamiento, con la finalidad exclusiva de generar y transmitir comprobantes electrónicos válidos ante el SRI.

## 4. Con quién compartimos datos (subencargados)

Los datos se almacenan y procesan utilizando los siguientes proveedores, todos bajo contrato de confidencialidad correspondiente a su rol de subencargado:

- **Render** — hosting de la aplicación.
- **Neon** — base de datos PostgreSQL.
- **Mailgun** — envío de correos transaccionales (verificación de cuenta, RIDE/PDF de comprobantes autorizados, notificaciones).
- **Sentry** — monitoreo de errores (configurado para minimizar el tratamiento de datos personales).
- **SRI (Servicio de Rentas Internas)** — autoridad tributaria ecuatoriana receptora obligatoria por mandato legal; la transmisión de comprobantes electrónicos es exigida por la normativa tributaria aplicable.

Algunos de estos proveedores pueden procesar datos en servidores ubicados fuera del Ecuador. Dichas transferencias se realizan únicamente para la prestación del Servicio y bajo los compromisos de confidencialidad y seguridad propios de cada proveedor.

No vendemos ni compartimos datos personales con terceros para fines comerciales o publicitarios.

Esta lista de proveedores puede actualizarse conforme evolucione la infraestructura del Servicio, garantizando en todo momento un nivel adecuado de protección de datos personales.

## 5. Medidas de seguridad

- **Aislamiento por tenant a nivel de base de datos** mediante Row-Level Security (RLS) de PostgreSQL — cada cuenta solo puede consultar sus propios registros.
- **Cifrado AES-256-GCM** de la clave privada de firma; la clave de cifrado se gestiona fuera de la base de datos.
- **TLS** en todas las comunicaciones con la API.
- **Acceso administrativo** restringido mediante mecanismos de autenticación independientes de las credenciales de los Clientes.
- La cuenta de base de datos utilizada por la aplicación no tiene privilegios de superusuario, y las políticas de RLS están diseñadas para impedir su elusión desde la capa de aplicación.

## 6. Registros (logs)

Comprobify registra información técnica de las solicitudes realizadas a la API, incluyendo direcciones IP, fechas, endpoints solicitados, identificadores de cuenta, y registros de eventos del ciclo de vida de cada comprobante, con la finalidad de garantizar la seguridad del Servicio, prevenir fraudes, diagnosticar errores y mantener la trazabilidad de las operaciones.

## 7. Cookies y tecnologías similares

Esta política cubre la API. El sitio web y el panel de administración (cuando existan) pueden utilizar cookies técnicas necesarias para mantener la sesión del usuario, garantizar la seguridad, y mejorar el funcionamiento del Servicio. Comprobify no utiliza cookies con fines publicitarios ni de seguimiento de terceros, salvo que se indique expresamente en el momento correspondiente.

## 8. Retención de datos

Comprobify conservará la información mientras resulte necesaria para la prestación del Servicio, el cumplimiento de obligaciones legales, contables, fiscales y de auditoría, la trazabilidad de los comprobantes electrónicos, y la atención de requerimientos administrativos o judiciales. Actualmente el sistema no implementa un mecanismo de eliminación definitiva de comprobantes electrónicos ni de su historial de auditoría y cumplimiento normativo; únicamente admite la desactivación lógica de recursos como emisores.

## 9. Derechos del titular de los datos

Bajo la LOPDP, los compradores cuyos datos constan en un comprobante pueden ejercer sus derechos de acceso, rectificación, actualización, eliminación (cuando proceda), oposición y portabilidad (si aplica), **directamente ante el Cliente** (Responsable del Tratamiento), quien decidió incluir esos datos. Comprobify, como Encargado, colaborará con el Cliente para atender dichas solicitudes en la medida técnicamente posible.

El Cliente, respecto de los datos de su propia cuenta (correo, certificado, historial de pagos), puede ejercer los mismos derechos señalados anteriormente directamente ante Comprobify, escribiendo a `[email de contacto]`.

## 10. Cambios a esta política

Publicaremos cualquier cambio material en esta página con una nueva fecha de versión. Cuando las modificaciones sean sustanciales y la legislación aplicable así lo requiera, Comprobify podrá solicitar una nueva aceptación antes de continuar utilizando el Servicio.

## 11. Contacto

`[Tu nombre completo]` — RUC `[RUC]` — Domicilio disponible previa solicitud razonable del interesado — `[email de contacto]`
