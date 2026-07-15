# Verificación de Salud

Devuelve el estado operativo de la API y confirma la conectividad con la base de datos. Usa este endpoint para health checks de balanceadores de carga, monitoreo de disponibilidad y sondas de liveness de contenedores.

```
GET /health
```

## Autenticación

No requerida.

## Respuesta

**200 OK** — la API está saludable y la base de datos es alcanzable.

```json
{
  "status": "ok",
  "uptime": 3412.87
}
```

**503 Service Unavailable** — la API está en ejecución pero no puede alcanzar la base de datos.

```json
{
  "status": "error",
  "uptime": 3412.87
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `status` | `string` | `"ok"` si está saludable, `"error"` si la base de datos no es alcanzable |
| `uptime` | `number` | Tiempo de actividad del proceso en segundos |

## Notas

- El endpoint siempre responde (incluso ante una falla de base de datos) — es el propio proceso del servidor reportando su estado.
- Una respuesta `503` significa que la aplicación está en ejecución pero no puede atender solicitudes que requieren la base de datos. El proceso debe considerarse no saludable y ser reemplazado.
- Este endpoint está intencionalmente excluido del límite de tasa y de la autenticación.
