# Registro

Registro por autoservicio. Crea un tenant, un emisor y una llave API de sandbox en una sola llamada. La llave API devuelta se muestra **una sola vez** — guárdala de inmediato.

```
POST /v1/register
```

## Autenticación

Ninguna — endpoint público.

## Límite de tasa

Compartido con `POST /v1/resend-verification` — 5 solicitudes por hora por IP.

## Cuerpo de la solicitud

`multipart/form-data` (requerido — debe incluirse un archivo de certificado P12).

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `cert` | file | Sí | Archivo de certificado P12 del SRI |
| `certPassword` | string | No | Contraseña del P12 (omitir si no tiene) |
| `logo` | file | No | Logo de la empresa a mostrar en los PDF RIDE. Formatos aceptados: **PNG** (recomendado), JPEG, GIF. Tamaño máximo: **500 KB**. Dimensiones recomendadas: **600 × 170 px** (horizontal, relación ~3.5:1). Se puede subir o reemplazar más adelante vía `PATCH /v1/issuers/:id/logo`. |
| `email` | string | Sí | Correo de contacto del tenant — usado para verificación y notificaciones de facturas |
| `ruc` | string | Sí | RUC de 13 dígitos |
| `businessName` | string | Sí | Razón social (máx. 300 caracteres) |
| `tradeName` | string | No | Nombre comercial |
| `mainAddress` | string | No | Dirección principal |
| `branchCode` | string | Sí | Código de sucursal de 3 dígitos, por ejemplo `001` |
| `issuePointCode` | string | Sí | Código de punto de emisión de 3 dígitos, por ejemplo `001` |
| `emissionType` | string | Sí | `1` (emisión normal) |
| `requiredAccounting` | boolean | Sí | Si el negocio está obligado a llevar contabilidad |
| `specialTaxpayer` | string | No | Código de contribuyente especial |
| `branchAddress` | string | No | Dirección de la sucursal |
| `documentTypes` | array | No | Códigos de tipo de comprobante a habilitar (por defecto: `["01"]`). Deben ser tipos soportados. |
| `initialSequentials` | array | No | Números secuenciales iniciales por tipo de comprobante. Cualquier tipo no listado tiene por defecto `1`. Ver estructura abajo. |
| `language` | string | No | Idioma para los correos salientes. Soportados: `es` (por defecto), `en`. Se guarda en el tenant y se usa para todos los correos posteriores, incluyendo reenvíos. |
| `verificationRedirectUrl` | string | No | URL del frontend a la que apuntará el enlace de verificación en el correo. El token se añade como `?token=<token>`. Si se omite, el enlace va directamente al endpoint de verificación de la API. |
| `termsVersion` | string | Sí | El string `version` del documento TERMS actualmente publicado (de `GET /v1/agreements`). El servidor valida esto antes de aceptar el registro. Si aún no se ha publicado ningún documento, se acepta cualquier string no vacío tal cual (mecanismo de respaldo previo al lanzamiento). |

### Estructura de `initialSequentials`

Cada entrada establece el primer número secuencial que se emitirá para un tipo de comprobante dado en este emisor. Útil al migrar desde otro sistema y necesitar continuidad.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `documentType` | string | Sí | Código de tipo de comprobante, por ejemplo `"01"` |
| `sequential` | integer | Sí | Siguiente número secuencial a emitir (≥ 1) |

```json
{
  "initialSequentials": [
    { "documentType": "01", "sequential": 500 }
  ]
}
```

### Comportamiento de `verificationRedirectUrl`

Cuando se establece, el correo de verificación contiene un enlace a tu página del frontend:

```
https://app.comprobify.com/verify?token=<64-char-hex>
```

Tu página del frontend debería mostrar una interfaz de confirmación y luego llamar a `GET /v1/verify-email?token=<token>` cuando el usuario actúe.

Cuando se omite, el enlace va directamente a la API:

```
https://api.comprobify.com/v1/verify-email?token=<64-char-hex>
```

**Validación:** en producción la URL debe usar `https`. En otros entornos, también se acepta `http`.

## Respuesta

### 201 Created — registro nuevo

```json
{
  "ok": true,
  "tenant": {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "you@company.com",
    "subscriptionTier": "FREE",
    "status": "PENDING_VERIFICATION",
    "documentQuota": 100,
    "documentCount": 0,
    "createdAt": "2026-04-30T00:00:00.000Z",
    "agreementAcceptedAt": "2026-06-28T12:00:00.000Z",
    "agreementVersion": "2026-06-28"
  },
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000001",
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": null,
    "branchCode": "001",
    "issuePointCode": "001",
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  },
  "apiKey": "abc123..."
}
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Campos faltantes o inválidos, o falta el archivo P12 o el `termsVersion` |
| `400` | `VERSION_MISMATCH` | `termsVersion` no coincide con la versión de TERMS actualmente publicada — vuelve a consultar `GET /v1/agreements` y muestra la versión actual |
| `400` | `BAD_REQUEST` | El archivo P12 está corrupto o la contraseña del certificado es incorrecta |
| `400` | `INVALID_FILE_UPLOAD` | El archivo de logo excede los 500 KB |
| `409` | `CONFLICT` | El RUC ya está registrado bajo otro correo, o el correo ya tiene una cuenta — usa [`POST /v1/recover`](recover.md) para recuperar el acceso |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

## Notas

- El tenant inicia en estado `PENDING_VERIFICATION`. Se envía de inmediato un correo de verificación (fire-and-forget).
- Los tenants no verificados pueden usar sandbox pero no pueden promoverse a producción.
- El token de verificación expira después del TTL configurado (24 horas por defecto). Usa `POST /v1/resend-verification` para emitir uno nuevo.
- Este endpoint es solo para cuentas nuevas — si el correo ya está registrado, la solicitud se rechaza con `409 CONFLICT` sin importar el estado de la cuenta. Si perdiste tu llave API, usa [`POST /v1/recover`](recover.md) en su lugar.
- Obtén el `termsVersion` actual desde `GET /v1/agreements` justo antes de mostrar la casilla de aceptación, no en la carga de la página — el servidor valida la versión enviada y rechaza las versiones desactualizadas.
- Los tenants que regresan y cuya versión de aceptación quedó desactualizada (por ejemplo, después de una actualización del DPA) deberían usar `GET /v1/tenants/agreements` para descubrir qué documentos necesitan volver a aceptarse, y `POST /v1/tenants/agreements` para registrar la nueva aceptación. Ver [Agreement Acceptance](agreement-acceptance.md).
