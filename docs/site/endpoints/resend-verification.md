# Reenviar Correo de Verificación

```
POST /v1/resend-verification
```

Reenvía el correo de verificación a un tenant registrado pero no verificado.

## Este no es un endpoint invocable por terceros

Al igual que [Registro](register.md), `POST /v1/resend-verification` requiere un encabezado `X-Internal-Service-Secret` válido — una credencial que solo posee la aplicación web de Comprobify. Una solicitud sin él es rechazada con `403 INTERNAL_SERVICE_ONLY`.

**Si nunca recibiste tu correo de verificación, o el enlace expiró, solicita uno nuevo desde la aplicación web de Comprobify.**

## Relacionado

- [Registro](register.md) — también restringido a la app web, por la misma razón
- [Verificar correo](verify-email.md) — el endpoint de comprobación ahí sigue siendo público
