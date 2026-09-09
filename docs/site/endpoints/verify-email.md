# Verificar Correo

Activa una cuenta de tenant usando el token del correo de verificación enviado en el registro. Una vez verificado, el tenant puede promover su cuenta a producción.

La verificación está dividida en una comprobación de solo lectura y una acción de consumo separada. Esta división existe porque los escáneres de enlaces de correo (por ejemplo, Microsoft Defender/Safe Links en direcciones de Outlook) precargan cada enlace de un correo con un simple `GET` antes de que el usuario haga clic — un `GET` combinado que comprobaba y consumía a la vez permitía que la precarga de un escáner quemara el token antes del clic real, dejando al usuario con un error `INVALID_OR_EXPIRED_TOKEN` en su primer clic genuino.

## Comprobar validez del token (sin consumir)

```
GET /v1/verify-email/check?token=<token>
```

Solo lectura — seguro de llamar repetidamente, incluso por escáneres de enlaces automatizados. Nunca activa la cuenta. Llama esto al cargar la página para mostrar al usuario si su enlace sigue siendo válido antes de que actúe sobre él.

### Autenticación

Ninguna — endpoint público. El token en la cadena de consulta actúa como credencial.

### Parámetros de consulta

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `token` | string (hexadecimal de 64 caracteres) | Sí | Token de verificación del correo de registro |

### Respuesta

```json
{ "valid": true, "email": "you@example.com" }
```

o, para un token inválido/expirado/desconocido:

```json
{ "valid": false }
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` falta, no es hexadecimal, o no tiene exactamente 64 caracteres |

## Confirmar la verificación

La acción de consumo real (`POST /v1/verify-email`) — la que activa el tenant — solo puede ser llamada por la aplicación web de Comprobify, igual que la creación de la cuenta (ver [Registro](register.md)). No se documenta aquí como un endpoint invocable por terceros. Si construiste tu propia página de verificación contra `verificationRedirectUrl`, usa el endpoint de comprobación de arriba para validar el token, y luego envía al usuario de vuelta a la aplicación web de Comprobify para confirmar.

### Notas

- Los tokens expiran después del TTL configurado (por defecto 24 horas). Un correo de verificación nuevo solo lo envía la aplicación web de Comprobify.
- El correo de verificación siempre enlaza a la URL con la que se creó la cuenta (`verificationRedirectUrl`) — ya no existe una página de verificación alojada en la API.
- La verificación es un requisito previo para promover una cuenta a producción. Los tenants no verificados pueden usar el sandbox pero no pueden cambiar a producción.
- Activar una cuenta registra un evento `EMAIL_VERIFIED` en el registro de eventos del tenant. La comprobación sin consumir de arriba nunca registra nada.
