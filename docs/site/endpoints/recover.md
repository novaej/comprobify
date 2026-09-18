# Recuperar cuenta

```
POST /v1/recover
```

Restablece el vínculo de la aplicación web de Comprobify con tu cuenta, verificando el certificado P12 usado en el registro.

## Este no es un endpoint invocable por terceros

Al igual que [Registro](register.md), `POST /v1/recover` requiere un encabezado `X-Internal-Service-Secret` válido — una credencial que solo posee la aplicación web de Comprobify. Una solicitud sin él es rechazada con `403 INTERNAL_SERVICE_ONLY`.

**Si la aplicación web de Comprobify muestra tu cuenta como no vinculada, usa su flujo de recuperación para corregirlo.** Esta sube tu certificado P12 en tu nombre y, si coincide, la API revoca la llave anterior del entorno actual de tu cuenta (sandbox o producción) y emite una nueva — la API key nunca se te muestra, sea la primera vez que se vincula tu cuenta a la app web o una resincronización de un vínculo que ya existía (ver [Primeros Pasos](../getting-started.md)). Esto no ayuda si simplemente olvidaste tu contraseña de la app web — eso lo maneja el propio restablecimiento de contraseña de la app web, algo no relacionado con este endpoint.

## Relacionado

- [Registro](register.md) — también restringido a la app web, por la misma razón
- [Verificar correo](verify-email.md) — la recuperación también fuerza una nueva verificación; el endpoint de comprobación ahí sigue siendo público
