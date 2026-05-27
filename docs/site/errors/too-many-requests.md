# Too Many Requests

**Status:** `429 Too Many Requests`

The request was throttled. Check the `code` field to distinguish between an API rate limit and an operation-specific cooldown.

## Codes

### `RESEND_COOLDOWN`

`POST /api/resend-verification` was called again before the 60-second server-side cooldown elapsed. This per-account cooldown prevents email flooding regardless of IP.

**What to do:** Wait 60 seconds from the previous resend request, then try again.

### `TOO_MANY_REQUESTS` — API rate limit

Your API key has exceeded the per-minute request limit.

**Limits (per API key):**
- **Write endpoints** (POST): 60 requests / minute
- **Read endpoints** (GET): 300 requests / minute

Rate limits are tiered. Higher subscription tiers carry higher limits — see your plan details.

**What to do:**
1. **Wait and retry** — Rate limits reset every minute.
2. **Implement exponential backoff** — When you receive a 429, wait 1 s, then 2 s, then 4 s, etc. before retrying.
3. **Optimise your requests** — Batch where possible, cache read results, avoid polling in a tight loop.
4. **Upgrade your plan** — If you consistently hit limits, a higher tier will raise them.

## Example retry logic (JavaScript)

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        const waitMs = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s...
        console.log(`Rate limited. Retrying in ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

## Example responses

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/too-many-requests",
  "title":    "Too Many Requests",
  "status":   429,
  "code":     "RESEND_COOLDOWN",
  "detail":   "Please wait before requesting another verification email.",
  "instance": "/api/resend-verification"
}
```

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/too-many-requests",
  "title":    "Too Many Requests",
  "status":   429,
  "code":     "TOO_MANY_REQUESTS",
  "detail":   "Rate limit exceeded for this API key",
  "instance": "/api/documents"
}
```
