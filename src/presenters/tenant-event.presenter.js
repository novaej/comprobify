function formatTenantEvent(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

module.exports = { formatTenantEvent };
