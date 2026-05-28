/**
 * Shared notification response formatter.
 *
 * Used by both the controller (HTTP responses) and the notification service
 * (SSE push payloads) so the shape is always identical.
 */
function formatNotification(n) {
  return {
    id:        n.id,
    type:      n.type,
    severity:  n.severity,
    title:     n.title,
    message:   n.message,
    metadata:  n.metadata || null,
    issuerId:  n.issuer_id,
    readAt:    n.read_at,
    expiresAt: n.expires_at,
    createdAt: n.created_at,
  };
}

module.exports = { formatNotification };
