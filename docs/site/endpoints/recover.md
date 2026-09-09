# Recuperar cuenta

```
POST /v1/recover
```

Recupera el acceso a una cuenta existente cuando se perdió la API key, verificando el certificado P12 usado en el registro.

## Este no es un endpoint invocable por terceros

Al igual que [Registro](register.md), `POST /v1/recover` requiere un encabezado `X-Internal-Service-Secret` válido — una credencial que solo posee la aplicación web de Comprobify. Una solicitud sin él es rechazada con `403 INTERNAL_SERVICE_ONLY`.

**Si perdiste tu API key, usa el flujo de recuperación de cuenta en la aplicación web de Comprobify.** Esta sube tu certificado P12 en tu nombre y, si coincide, te emite una llave nueva para el entorno actual de tu cuenta (sandbox o producción) — el mismo resultado que este endpoint siempre produjo, solo que iniciado desde la app en lugar de directamente contra la API.

## Relacionado

- [Registro](register.md) — también restringido a la app web, por la misma razón
- [Verificar correo](verify-email.md) — la recuperación también fuerza una nueva verificación; el endpoint de comprobación ahí sigue siendo público
