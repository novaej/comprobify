# Registro

```
POST /v1/register
```

Crea un tenant, un emisor y una API key de sandbox en una sola llamada.

## Este no es un endpoint invocable por terceros

`POST /v1/register` requiere un encabezado `X-Internal-Service-Secret` válido, una credencial que solo posee la aplicación web de Comprobify. Una solicitud sin él es rechazada con `403 INTERNAL_SERVICE_ONLY` — no hay forma de que una integración de terceros cree una cuenta de Comprobify directamente contra esta API.

**Para obtener una cuenta, regístrate en la aplicación web de Comprobify.** Una vez que tu cuenta existe, esta te entrega la misma API key con todos los permisos que `POST /v1/register` habría devuelto — consulta [Primeros Pasos](../getting-started.md) para ver qué puedes hacer con esa llave sin ninguna configuración adicional.

Si estás construyendo tu propio frontend sobre Comprobify y necesitas que tus usuarios se registren sin pasar por la aplicación web de Comprobify, contacta a soporte — el acceso directo al registro es una decisión comercial, no algo de autoservicio.

## Relacionado

- [Recuperar cuenta](recover.md) — también restringido a la app web, por la misma razón
- [Verificar correo](verify-email.md) — la única parte del flujo de creación de cuenta que sigue siendo pública
