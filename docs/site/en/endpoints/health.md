# Health Check

Returns the operational status of the API and confirms database connectivity. Use this endpoint for load balancer health checks, uptime monitoring, and container liveness probes.

```
GET /health
```

## Authentication

None required.

## Response

**200 OK** — API is healthy and database is reachable.

```json
{
  "status": "ok",
  "uptime": 3412.87
}
```

**503 Service Unavailable** — API is running but cannot reach the database.

```json
{
  "status": "error",
  "uptime": 3412.87
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `string` | `"ok"` if healthy, `"error"` if the database is unreachable |
| `uptime` | `number` | Process uptime in seconds |

## Notes

- The endpoint always responds (even on DB failure) — it is the server process itself reporting its state.
- A `503` response means the application is running but cannot serve requests that require the database. The process should be considered unhealthy and replaced.
- This endpoint is intentionally excluded from rate limiting and authentication.
