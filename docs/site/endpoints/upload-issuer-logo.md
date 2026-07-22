# Subir Logo del Emisor

Sube o reemplaza el logo de un emisor. El logo se almacena en la base de datos y se renderiza automáticamente en la esquina superior izquierda de cada RIDE en PDF generado para ese emisor — incluyendo los PDF enviados como adjuntos de correo al momento de la autorización.

```
PATCH /v1/issuers/:id/logo
```

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor (obtenido de `GET /v1/issuers`) |

## Cuerpo de la solicitud

`multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `logo` | archivo | Sí | Imagen del logo. Formatos aceptados: **PNG** (recomendado), JPEG, GIF. Tamaño máximo: **500 KB**. Dimensiones recomendadas: **600 × 170 px**. |

## Respuesta

**200 OK**

```json
{ "ok": true }
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un entero positivo |
| `400` | `INVALID_FILE_UPLOAD` | No se proporcionó ningún archivo, el archivo supera los 500 KB, o el tipo MIME no es compatible |
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | Emisor no encontrado o inactivo |
| `429` | `TOO_MANY_REQUESTS` | Límite de tasa excedido |

## Notas

- Volver a llamar a este endpoint sobrescribe el logo existente — no existe un endpoint de eliminación por separado; para quitar un logo, vuelve a registrarte o contacta a soporte.
- El logo se incrusta directamente en el PDF al momento de renderizarlo. No se expone ninguna URL pública.
- El logo también se puede proporcionar en el momento del registro mediante el campo opcional de archivo `logo` en `POST /v1/register`.

## Guía de dimensiones del logo

El logo se renderiza en la celda superior izquierda del encabezado del RIDE en PDF, escalado para ajustarse a un cuadro delimitador de **213 × 60 pt** (relación de aspecto ~3.5:1). La imagen se escala proporcionalmente — nunca se estira.

| | Valor |
|---|---|
| **Tamaño recomendado** | 600 × 170 px |
| **Tamaño máximo útil** | 900 × 250 px (un tamaño mayor solo agrega peso al archivo sin ganancia visible de calidad) |
| **Tamaño mínimo** | 213 × 60 px |
| **Relación de aspecto** | ~3.5:1 (horizontal) |
| **Formato recomendado** | PNG — admite transparencia, sin pérdida, ideal para logos con texto o bordes definidos |
| **Formatos aceptados** | PNG, JPEG, GIF |
| **Tamaño máximo de archivo** | 500 KB |

**Consejos:**
- Usa PNG con fondo transparente para que el logo se integre naturalmente con el fondo blanco del PDF.
- Evita imágenes en orientación vertical — se escalarán hacia abajo para ajustarse a la altura de 60 pt y se verán angostas.
- JPEG es adecuado para logos fotográficos, pero puede mostrar artefactos de compresión en texto o bordes definidos.
- GIF es aceptado pero está limitado a 256 colores y sin transparencia suave — no se recomienda para logos modernos.
