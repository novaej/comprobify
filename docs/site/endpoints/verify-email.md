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

## Confirmar verificación (consume el token)

```
POST /v1/verify-email
Content-Type: application/json

{ "token": "<token>" }
```

La acción de consumo real — activa el tenant y no puede ser activada por una precarga `GET` automatizada. Llama esto únicamente en respuesta a una acción explícita del usuario (por ejemplo, un botón "Verificar mi correo"), nunca automáticamente al cargar la página.

### Autenticación

Ninguna — endpoint público. El token en el cuerpo de la solicitud actúa como credencial.

### Parámetros del cuerpo

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `token` | string (hexadecimal de 64 caracteres) | Sí | Token de verificación del correo de registro |

### Respuesta

```json
{
  "ok": true,
  "email": "you@example.com",
  "message": "Correo verificado. Ahora puedes promover tu cuenta a producción."
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` falta, no es hexadecimal, o no tiene exactamente 64 caracteres |
| `400` | `INVALID_OR_EXPIRED_TOKEN` | El token no coincide con ningún tenant pendiente, o ha expirado |

## Alternativa heredada (`GET` que consume)

```
GET /v1/verify-email?token=<token>
```

Combina comprobación y consumo en un único `GET`, mantenido por compatibilidad hacia atrás. Es a esto a lo que enlaza directamente el correo de verificación cuando no se configuró `verificationRedirectUrl` en el registro (por ejemplo, un consumidor que usa la API directamente en lugar de a través de un frontend propio). Las integraciones nuevas con su propia página de verificación deberían usar en su lugar el par comprobar/confirmar de arriba — un flujo basado solo en `GET` sigue siendo vulnerable al problema de los escáneres de enlaces descrito arriba.

### Autenticación

Ninguna — endpoint público. El token en la cadena de consulta actúa como credencial.

### Parámetros de consulta

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `token` | string (hexadecimal de 64 caracteres) | Sí | Token de verificación del correo de registro |

### Respuesta

```json
{
  "ok": true,
  "email": "you@example.com",
  "message": "Correo verificado. Ahora puedes promover tu cuenta a producción."
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `token` falta, no es hexadecimal, o no tiene exactamente 64 caracteres |
| `400` | `INVALID_OR_EXPIRED_TOKEN` | El token no coincide con ningún tenant pendiente, o ha expirado |

## Notas

- Los tokens expiran después del TTL configurado (por defecto 24 horas). Usa `POST /v1/resend-verification` para obtener uno nuevo.
- Si se configuró `verificationRedirectUrl` en el registro, el enlace del correo apunta a esa URL en lugar de directamente a la API — el frontend en esa URL es responsable de leer el parámetro de consulta `token` y de dirigir el flujo comprobar → confirmar de arriba (o de recurrir al `GET` heredado si no implementa su propia página).
- La verificación es un requisito previo para `POST /v1/tenants/promote`. Los tenants no verificados pueden usar el sandbox pero no pueden cambiar a producción.
- Activar una cuenta (ya sea vía el `POST` de confirmación o el `GET` heredado) registra un evento `EMAIL_VERIFIED` en el registro de eventos del tenant. La comprobación sin consumir nunca registra nada.
