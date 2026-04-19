# Too Many Requests

Your API key has exceeded the rate limit. All authenticated requests are limited per API key.

## Limits

- **Write endpoints** (POST): 60 requests per minute
- **Read endpoints** (GET): 300 requests per minute

## Why you're seeing this error

You made too many requests with this API key in a short time. Rate limiting protects the service and prevents accidental or malicious abuse.

## How to resolve

1. **Wait and retry** — Rate limits reset every minute. Wait 60 seconds before retrying.
2. **Implement exponential backoff** — When you receive a `429`, wait 1s, then 2s, then 4s, etc. before retrying.
3. **Optimize your requests** — Batch operations when possible, cache read results, and avoid unnecessary requests.
4. **Contact support** — If you consistently hit limits, we can discuss increasing your quota.

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
        throw error;  // Not a rate limit error, re-throw
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const document = await requestWithRetry(() => 
  fetch('/api/documents', { headers: { Authorization: `Bearer ${apiKey}` } })
);
```

## Response format

```json
{
  "type": "https://novaej.github.io/comprobify/errors/too-many-requests",
  "title": "Too Many Requests",
  "status": 429,
  "code": "TOO_MANY_REQUESTS",
  "detail": "Rate limit exceeded for this API key",
  "instance": "/api/documents"
}
```

Use the `code` field (`TOO_MANY_REQUESTS`) for client-side error handling, not the status code.
