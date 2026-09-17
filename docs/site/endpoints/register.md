# Registro

```
POST /v1/register
```

Crea un tenant, un emisor y una API key de sandbox en una sola llamada.

## Este no es un endpoint invocable por terceros

`POST /v1/register` requiere un encabezado `X-Internal-Service-Secret` válido, una credencial que solo posee la aplicación web de Comprobify. Una solicitud sin él es rechazada con `403 INTERNAL_SERVICE_ONLY` — no hay forma de que una integración de terceros cree una cuenta de Comprobify directamente contra esta API.

**Para obtener una cuenta, regístrate en la aplicación web de Comprobify.** Una vez que tu cuenta existe, la API crea una llave con todos los permisos — pero la aplicación web **no te muestra su texto**: la guarda cifrada y la usa internamente para operar tu panel. Consulta [Primeros Pasos](../getting-started.md) para lo que eso significa si necesitas integrar tu propio sistema directamente contra la API.

Si estás construyendo tu propio frontend sobre Comprobify y necesitas que tus usuarios se registren sin pasar por la aplicación web de Comprobify, contacta a soporte — el acceso directo al registro es una decisión comercial, no algo de autoservicio.

## Relacionado

- [Recuperar cuenta](recover.md) — también restringido a la app web, por la misma razón
- [Verificar correo](verify-email.md) — la única parte del flujo de creación de cuenta que sigue siendo pública
