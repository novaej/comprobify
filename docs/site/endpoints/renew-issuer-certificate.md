# Renovar Certificado del Emisor

Reemplaza el certificado P12 (llave privada + certificado X.509) almacenado para un emisor — por ejemplo, cuando el certificado existente ha vencido o está por vencer. Solo se actualiza la fila de ese emisor; las sucursales hermanas que previamente heredaron el certificado vía `sourceIssuerId` conservan su propia copia hasta que se renueven individualmente.

```
PATCH /v1/issuers/:id/certificate
```

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor (de `GET /v1/issuers`) |

## Cuerpo de la solicitud

`multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `cert` | file | Sí | Archivo de certificado P12/PFX emitido por una entidad certificadora ecuatoriana autorizada (BANCO CENTRAL o SECURITY DATA). |
| `certPassword` | string | No | Contraseña que protege el archivo P12, si tiene alguna. |

## Respuesta

**200 OK**

```json
{ "ok": true, "certFingerprint": "a1b2c3...", "certExpiry": "2028-06-23T00:00:00.000Z" }
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un entero positivo |
| `400` | `INVALID_FILE_UPLOAD` | No se proporcionó archivo `cert` |
| `400` | `CERTIFICATE_INVALID` | El archivo no es un archivo PKCS#12 válido |
| `400` | `CERTIFICATE_PASSWORD_INVALID` | `certPassword` incorrecta |
| `400` | `CERTIFICATE_KEY_NOT_FOUND` | No se encontró ningún bag de llave de firma de BANCO CENTRAL/SECURITY DATA en el P12 |
| `400` | `CERTIFICATE_EXPIRED` | El certificado subido ya está vencido |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | Emisor no encontrado o inactivo |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

## Notas

- **No afecta a los comprobantes ya firmados.** Cada factura firmada incorpora su propia copia del certificado de firma dentro de la firma XML (`<ds:X509Certificate>`) al momento de firmar — no es una referencia en vivo a la fila del emisor. Renovar el certificado solo cambia lo que se usa para *futuras* firmas: nuevas llamadas a `POST /v1/documents` y cualquier reconstrucción posterior de comprobantes `RETURNED`/`NOT_AUTHORIZED`.
- La renovación se limita al emisor indicado en la URL. Si el mismo P12 cubre varias sucursales/puntos de emisión bajo el mismo RUC, renueva cada fila de emisor por separado (o pasa el mismo archivo a cada una).
- Existe una alternativa de administrador en `PATCH /v1/admin/issuers/:id/certificate` (sin verificación de propiedad del tenant).
