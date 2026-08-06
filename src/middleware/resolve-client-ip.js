// api is only reachable via Caddy (docker-compose exposes 8080 internally, never
// publishes it) - so X-Real-Client-IP, set by Caddy from its own trusted {client_ip}
// resolution (see deploy/caddy/Caddyfile), can be trusted unconditionally here. Overriding
// req.ip directly (rather than fighting Express's trust-proxy/X-Forwarded-For hop
// counting) means every consumer - rate limiters, request-logger, the agreements
// audit trail - gets the real client IP without depending on Caddy's own automatic
// X-Forwarded-For augmentation behavior.
function resolveClientIp(req, res, next) {
  const realIp = req.headers['x-real-client-ip'];
  if (realIp) {
    Object.defineProperty(req, 'ip', { value: realIp, configurable: true, enumerable: true });
  }
  next();
}

module.exports = resolveClientIp;
