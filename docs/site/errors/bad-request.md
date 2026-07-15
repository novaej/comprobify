# Bad Request

**Estado HTTP:** `400 Bad Request`

La solicitud es sintácticamente válida pero no puede procesarse en el contexto actual. Cada error 400 lleva un `code` específico — úsalo para manejar cada caso de forma programática sin analizar la cadena de `detail`.

## Códigos

### `CERTIFICATE_INVALID`

El archivo P12 subido no pudo ser analizado. El archivo puede estar corrupto, truncado, o no ser un archivo PKCS#12 válido.

**Qué hacer:** Exporta un P12 nuevo desde tu autoridad certificadora y vuelve a subirlo.

### `CERTIFICATE_PASSWORD_INVALID`

La contraseña proporcionada para el archivo P12 es incorrecta.

**Qué hacer:** Verifica la contraseña y vuelve a intentarlo. Ten en cuenta que las contraseñas distinguen entre mayúsculas y minúsculas.

### `CERTIFICATE_KEY_NOT_FOUND`

El archivo P12 fue analizado correctamente pero no contiene un bag de llave de firma reconocible. La API soporta los formatos de certificado de **BANCO CENTRAL** y **SECURITY DATA**.

**Qué hacer:** Asegúrate de que el P12 fue exportado desde una CA compatible con la llave privada incluida.

### `CERTIFICATE_EXPIRED`

La fecha `notAfter` del certificado ya pasó. El campo `detail` incluye la fecha exacta de expiración.

**Qué hacer:** Renueva el certificado con tu CA, luego sube el nuevo P12 al emisor. Todos los comprobantes nuevos usarán el certificado actualizado de inmediato.

### `ISSUER_ID_REQUIRED`

Falta el encabezado de solicitud `X-Issuer-Id`. Toda solicitud de creación y gestión de comprobantes debe especificar a qué emisor apunta.

**Qué hacer:** Agrega `X-Issuer-Id: <issuer-id>` a la solicitud. Obtén los IDs de los emisores de tu tenant con `GET /v1/issuers`.

### `ISSUER_ID_INVALID`

El valor del encabezado `X-Issuer-Id` no es un entero positivo válido (p. ej. `abc`, `0`, `-5`).

**Qué hacer:** Proporciona el ID numérico del emisor devuelto por `GET /v1/issuers`.

### `INVALID_OR_EXPIRED_TOKEN`

El token de verificación de correo en el parámetro de consulta de la URL (`?token=…`) es inválido o ha expirado. Los tokens expiran después de 24 horas (configurable vía `VERIFICATION_TOKEN_TTL_HOURS`).

**Qué hacer:** Solicita un token nuevo vía `POST /v1/resend-verification`.

### `DOCUMENT_TYPE_NOT_ENABLED`

El campo `documentType` en el cuerpo de la solicitud especifica un tipo de comprobante que actualmente no está activo para este emisor. El campo `detail` lista los tipos permitidos.

**Qué hacer:** Habilita el tipo de comprobante vía `POST /v1/issuers/:id/document-types`, o usa uno de los tipos permitidos listados en `detail`.

### `DOCUMENT_TYPE_NOT_SUPPORTED`

El código de tipo de comprobante no está registrado en la API en absoluto (a diferencia de simplemente estar inactivo para este emisor).

**Qué hacer:** Revisa los tipos soportados con `GET /v1/issuers/:id/document-types`. Solo los tipos registrados pueden habilitarse.

### `INVALID_STATE_TRANSITION`

La operación solicitada no es válida para el estado actual del comprobante. El campo `detail` nombra la transición intentada.

**Qué hacer:** Revisa el estado actual del comprobante con [Get Document](../endpoints/get-document.md) y realiza únicamente las operaciones permitidas para ese estado:

| Estado | Operaciones permitidas |
|---|---|
| `SIGNED` | Enviar al SRI |
| `RECEIVED` | Consultar autorización |
| `RETURNED` | Reconstruir |
| `NOT_AUTHORIZED` | Reconstruir |
| `AUTHORIZED` | Descargar RIDE, descargar XML, reintentar correo |

### `DOCUMENT_NOT_AUTHORIZED`

La operación requiere que el comprobante tenga estado `AUTHORIZED`. Esto aplica a la generación del RIDE (`GET /:key/ride`) y a los reintentos manuales de correo.

**Qué hacer:** Completa primero el ciclo de vida completo del comprobante (enviar → autorizar).

### `SELF_REVOCATION_FORBIDDEN`

No puedes revocar la llave API que autenticó la solicitud actual.

**Qué hacer:** Usa una llave API activa distinta para revocar esta. Lista tus llaves con `GET /v1/keys`.

### `INVALID_FILE_UPLOAD`

Un archivo subido (p. ej. un certificado P12 o el logo del emisor) falta, es del tipo MIME incorrecto, o excede el límite de tamaño del campo. El campo `detail` nombra la restricción específica que falló — por ejemplo, un logo de más de 500 KB en `POST /v1/register` o `PATCH /v1/issuers/:id/logo`.

**Qué hacer:** Verifica el archivo contra los límites documentados en el endpoint (p. ej. [Upload Issuer Logo](../endpoints/upload-issuer-logo.md)) y vuelve a subirlo.

### `BAD_REQUEST` (respaldo)

Una solicitud incorrecta genérica no cubierta por un código específico de los anteriores. Lee el campo `detail` para conocer la razón.

## Ejemplo de respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/bad-request",
  "title":    "Bad Request",
  "status":   400,
  "code":     "CERTIFICATE_EXPIRED",
  "detail":   "El certificado expiró el 2025-03-15. Reemplaza el archivo P12 de este emisor antes de crear comprobantes.",
  "instance": "/v1/documents"
}
```
