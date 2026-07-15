# Verificar Correo

Activa una cuenta de tenant usando el token del correo de verificación enviado en el registro. Una vez verificado, el tenant puede promover su cuenta a producción.

```
GET /v1/verify-email?token=<token>
```

## Autenticación

Ninguna — endpoint público. El token en la cadena de consulta actúa como credencial.

## Parámetros de consulta

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `token` | string (hexadecimal de 64 caracteres) | Sí | Token de verificación del correo de registro |

## Respuesta

```json
{
  "ok": true,
  "email": "you@example.com",
  "message": "Correo verificado. Ahora puedes promover tu cuenta a producción."
}
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` falta, no es hexadecimal, o no tiene exactamente 64 caracteres |
| `400` | `INVALID_OR_EXPIRED_TOKEN` | El token no coincide con ningún tenant pendiente, o ha expirado |

## Notas

- Los tokens expiran después del TTL configurado (por defecto 24 horas). Usa `POST /v1/resend-verification` para obtener uno nuevo.
- Si se configuró `verificationRedirectUrl` en el registro, el enlace del correo apunta a esa URL en lugar de directamente a este endpoint — el frontend es entonces responsable de llamar a `GET /v1/verify-email?token=<token>` con el token que recibe.
- La verificación es un requisito previo para `POST /v1/tenants/promote`. Los tenants no verificados pueden usar el sandbox pero no pueden cambiar a producción.
- Activar una cuenta registra un evento `EMAIL_VERIFIED` en el registro de eventos del tenant.
