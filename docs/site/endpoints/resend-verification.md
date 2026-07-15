# Reenviar Correo de Verificación

Reenvía el correo de verificación a un tenant registrado pero no verificado. Genera un token nuevo (invalidando el anterior) y reinicia el vencimiento.

```
POST /v1/resend-verification
```

## Autenticación

Ninguna — endpoint público.

## Límite de tasa

Aplican dos límites independientes:

- **Basado en IP:** compartido con `POST /v1/register` — 5 solicitudes por hora por IP.
- **Enfriamiento por cuenta:** 60 segundos entre reenvíos para el mismo correo. Si se incumple, devuelve `429`.

## Cuerpo de la solicitud

```json
{
  "email": "your@email.com",
  "verificationRedirectUrl": "https://app.example.com/verify"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `email` | string | Sí | Correo usado en el registro |
| `verificationRedirectUrl` | string (URL) | No | Si se proporciona, sobrescribe la URL de redirección incorporada en el enlace de verificación. Debe ser `https` en producción. Omítelo para conservar la URL establecida en el registro. |

## Respuesta

```json
{
  "ok": true,
  "message": "Si ese correo está registrado y no verificado, se ha enviado un nuevo correo de verificación."
}
```

El mensaje es intencionalmente genérico — el endpoint no revela si el correo existe en el sistema.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | El campo `email` falta o es inválido |
| `409` | `CONFLICT` | La cuenta ya está verificada |
| `403` | `FORBIDDEN` | La cuenta ha sido suspendida |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa por IP, o aún no ha transcurrido el enfriamiento de 60 segundos por cuenta |

## Notas

- El token anterior se invalida de inmediato — solo funcionará el token recién emitido.
- El nuevo token expira después del TTL configurado (24 horas por defecto).
- Si se proporciona `verificationRedirectUrl`, sobrescribe el valor almacenado en el tenant y se usa para todos los correos de verificación posteriores, incluyendo futuros reenvíos. Omite el campo para mantener la URL existente sin cambios.
- El estado de entrega se rastrea de la misma forma que los correos de facturas: `verification_email_status` en la fila del tenant se actualiza a `SENT`, `DELIVERED`, `FAILED`, o `COMPLAINED` vía el webhook de Mailgun.
- Si `EMAIL_PROVIDER=none`, el token igual se regenera en la base de datos pero no se envía ningún correo.
