# Actualizar Idioma Preferido

Actualiza el idioma preferido para el tenant autenticado. El idioma se usa para todos los correos que Comprobify envía por tu cuenta: verificación, notificaciones y el correo de cada comprobante autorizado.

```
PATCH /v1/tenants/language
```

## Autenticación

Bearer token — se requiere API key con el scope `tenant:manage`.

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
| `403` | `ACCOUNT_SUSPENDED` | La cuenta está suspendida |
| `403` | `INSUFFICIENT_SCOPE` | La API key no tiene el scope `tenant:manage` |
| `429` | `TOO_MANY_REQUESTS` | Límite de solicitudes excedido |

## Notas

- El idioma configurado en el registro se usa como valor inicial (por defecto `es`).
- Este endpoint permite actualizar el idioma después del registro sin necesidad de volver a registrarse.
- Idiomas admitidos: `es` (español), `en` (inglés).
- Aplica a todos los correos que Comprobify envía por tu cuenta: los de verificación, los de notificaciones (pagos, renovaciones, cambios de precio) y el correo con el RIDE y el XML que recibe el comprador de cada comprobante autorizado. Este último usa el idioma de **tu cuenta**, no el del comprador — no existe un campo de idioma del comprador.
- **Desde la aplicación web se llama automáticamente.** Cuando cambias el idioma de la interfaz en la aplicación web, esta usa este endpoint por ti y guarda ese idioma como el de la cuenta, así que los correos siguen el idioma que elegiste allí. Solo lo hace el propietario de la cuenta (quien puede administrarla); si otro usuario del equipo cambia el idioma, solo cambia su propia vista y el idioma de los correos no se modifica.
- Si integras tu propio sistema (planes Starter en adelante) puedes llamarlo directamente con una llave que tenga el scope `tenant:manage`.
