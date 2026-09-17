# Recuperar cuenta

```
POST /v1/recover
```

Recupera el acceso a una cuenta existente cuando se perdió la API key, verificando el certificado P12 usado en el registro.

## Este no es un endpoint invocable por terceros

Al igual que [Registro](register.md), `POST /v1/recover` requiere un encabezado `X-Internal-Service-Secret` válido — una credencial que solo posee la aplicación web de Comprobify. Una solicitud sin él es rechazada con `403 INTERNAL_SERVICE_ONLY`.

**Si perdiste el acceso a tu cuenta, usa el flujo de recuperación en la aplicación web de Comprobify.** Esta sube tu certificado P12 en tu nombre y, si coincide, la API revoca la llave anterior del entorno actual de tu cuenta (sandbox o producción) y emite una nueva. Si tu cuenta ya está vinculada a la aplicación web — el caso normal para cualquiera que se registró ahí — esa llave nueva se guarda cifrada y **tampoco se te muestra**, igual que en el registro (ver [Primeros Pasos](../getting-started.md)). Solo ves el texto de la llave si estás vinculando por primera vez una cuenta que originalmente se creó por fuera de la aplicación web.

## Relacionado

- [Registro](register.md) — también restringido a la app web, por la misma razón
- [Verificar correo](verify-email.md) — la recuperación también fuerza una nueva verificación; el endpoint de comprobación ahí sigue siendo público
