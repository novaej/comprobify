const notificationService = require('../services/notification.service');
const { formatNotification } = require('../presenters/notification.presenter');
const NotFoundError = require('../errors/not-found-error');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the optional X-Issuer-Id header.
 * Returns the parsed integer, or null if the header is absent.
 * Throws 400 ISSUER_ID_INVALID if the header is present but malformed.
 *
 * @param {import('express').Request} req
 * @returns {number|null}
 */
function parseOptionalIssuerId(req) {
  const header = req.headers['x-issuer-id'];
  if (!header) return null;

  const id = parseInt(header, 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== String(header).trim()) {
    throw new AppError('X-Issuer-Id must be a positive integer', 400, ErrorCodes.ISSUER_ID_INVALID);
  }
  return id;
}

function buildListResponse(notifications) {
  const formatted = notifications.map(formatNotification);
  return {
    notifications: formatted,
    unreadCount:   formatted.filter(n => !n.readAt).length,
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * GET /api/notifications
 *
 * Returns active notifications for the authenticated tenant.
 * When X-Issuer-Id is provided, filters to that issuer's notifications plus
 * any tenant-level ones (issuer_id IS NULL). Omit the header to get all.
 */
async function list(req, res) {
  const issuerId = parseOptionalIssuerId(req);
  const notifications = await notificationService.listForTenant(req.tenant.id, issuerId);
  res.json(buildListResponse(notifications));
}

/**
 * POST /api/notifications/sync
 *
 * Runs all periodic notification checks (cert expiry + any future checks) for
 * the tenant, then returns the updated notification list.
 *
 * Cert checks always run across ALL tenant issuers regardless of X-Issuer-Id —
 * it is a tenant-wide maintenance operation. The returned list is filtered by
 * X-Issuer-Id when provided, same as GET /.
 *
 * The frontend backend should call this on a schedule (e.g. daily cron, on login).
 * The check is idempotent.
 */
async function sync(req, res) {
  const issuerId = parseOptionalIssuerId(req);
  await notificationService.runChecksForTenant(req.tenant.id);
  const notifications = await notificationService.listForTenant(req.tenant.id, issuerId);
  res.json(buildListResponse(notifications));
}

/**
 * POST /api/notifications/:id/read
 *
 * Marks a notification as read. The frontend calls this only when every user
 * with access to the notification has marked it read on their side.
 * Returns 404 if the notification does not exist, belongs to a different tenant,
 * or is already read.
 */
async function markRead(req, res) {
  const id = parseInt(req.params.id, 10);
  const notification = await notificationService.markRead(id, req.tenant.id);
  if (!notification) throw new NotFoundError('Notification');
  res.json({ notification: formatNotification(notification) });
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * GET /api/notifications/preferences
 *
 * Returns the full preference list for the tenant, including defaults (enabled = true)
 * for types the tenant has never explicitly configured.
 */
async function getPreferences(req, res) {
  const preferences = await notificationService.getPreferences(req.tenant.id);
  res.json({ preferences });
}

/**
 * PATCH /api/notifications/preferences
 *
 * Bulk-upsert notification preferences.
 * Body: [{ "type": "DOCUMENT_AUTHORIZED", "enabled": false }, ...]
 * Returns the full updated preference list.
 */
async function updatePreferences(req, res) {
  const preferences = await notificationService.updatePreferences(req.tenant.id, req.body);
  res.json({ preferences });
}

module.exports = { list, sync, markRead, getPreferences, updatePreferences };
