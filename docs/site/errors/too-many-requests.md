# Too Many Requests

**Estado HTTP:** `429 Too Many Requests`

La solicitud fue limitada. Revisa el campo `code` para distinguir entre un límite de tasa de la API y un período de espera específico de una operación.

## Códigos

### `RESEND_COOLDOWN`

`POST /v1/resend-verification` fue llamado de nuevo antes de que transcurriera el período de espera de 60 segundos del lado del servidor. Este período de espera por cuenta evita la inundación de correos sin importar la IP.

**Qué hacer:** Espera 60 segundos desde la solicitud de reenvío anterior, luego vuelve a intentarlo.

### `TOO_MANY_REQUESTS` — límite de tasa de la API

Tu API key excedió el límite de solicitudes por minuto.

**Límites (por API key):**
- **Endpoints de escritura** (POST): 60 solicitudes / minuto
- **Endpoints de lectura** (GET): 300 solicitudes / minuto

Los límites de tasa son escalonados por plan. Los planes de suscripción más altos tienen límites más altos — consulta los detalles de tu plan.

**Qué hacer:**
1. **Espera y reintenta** — Los límites de tasa se reinician cada minuto.
2. **Implementa retroceso exponencial** — Cuando recibas un 429, espera 1 s, luego 2 s, luego 4 s, etc. antes de reintentar.
3. **Optimiza tus solicitudes** — Agrupa cuando sea posible, guarda en caché los resultados de lectura, evita el sondeo (polling) en un ciclo cerrado.
4. **Mejora tu plan** — Si alcanzas los límites de forma constante, un tier más alto los aumentará.

## Ejemplo de lógica de reintento (JavaScript)

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        const waitMs = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s...
        console.log(`Límite alcanzado. Reintentando en ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Se excedió el número máximo de reintentos');
}
```

## Ejemplos de respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/too-many-requests",
  "title":    "Too Many Requests",
  "status":   429,
  "code":     "RESEND_COOLDOWN",
  "detail":   "Por favor espera antes de solicitar otro correo de verificación.",
  "instance": "/v1/resend-verification"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/too-many-requests",
  "title":    "Too Many Requests",
  "status":   429,
  "code":     "TOO_MANY_REQUESTS",
  "detail":   "Se excedió el límite de tasa para esta API key",
  "instance": "/v1/documents"
}
```
