# Actualizar Idioma Preferido

Actualiza el idioma preferido para el tenant autenticado. El idioma se usa para todos los correos salientes (verificación, y futuros correos de comprobantes).

```
PATCH /v1/tenants/language
```

## Autenticación

Bearer token — se requiere API key.

## Cuerpo de la solicitud

```json
{
  "language": "en"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `language` | string | Sí | Código de idioma. Valores admitidos: `es`, `en` |

## Respuesta

```json
{
  "ok": true
}
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `language` falta o no es un valor admitido |
| `401` | `UNAUTHORIZED` | API key faltante o inválida |
| `403` | `FORBIDDEN` | La cuenta está suspendida |
| `429` | `TOO_MANY_REQUESTS` | Límite de tasa excedido |

## Notas

- El idioma configurado en el registro (`POST /v1/register`) se usa como valor inicial (por defecto `es`).
- Este endpoint permite actualizar el idioma después del registro sin necesidad de volver a registrarse.
- Idiomas admitidos: `es` (español), `en` (inglés).
- La preferencia de idioma aplica a todos los tipos de correo — actualmente correos de verificación, y correos de comprobantes en una futura versión.
