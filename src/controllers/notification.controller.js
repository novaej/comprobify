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

/**
 * Parse the optional ?sinceId query parameter.
 * Returns the parsed integer, or null if absent.
 * Throws 400 if present but not a valid positive integer.
 *
 * @param {import('express').Request} req
 * @returns {number|null}
 */
function parseSinceId(req) {
  const raw = req.query.sinceId;
  if (raw === undefined || raw === '') return null;

  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== String(raw).trim()) {
    throw new AppError('sinceId must be a positive integer', 400, ErrorCodes.ISSUER_ID_INVALID);
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
 *
 * Query parameters:
 *   ?sinceId=<id>     — Return only notifications with id > sinceId. Use this
 *                       for catch-up polling after downtime: store the highest
 *                       id seen from the previous poll and pass it on the next.
 *
 * Headers:
 *   X-Issuer-Id       — Optional. When provided, filters to that issuer's
 *                       notifications plus tenant-level ones (issuer_id IS NULL).
 *                       Omit to retrieve all tenant notifications.
 */
async function list(req, res) {
  const issuerId = parseOptionalIssuerId(req);
  const sinceId  = parseSinceId(req);
  const notifications = await notificationService.listForTenant(req.tenant.id, issuerId, sinceId);
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
  const id = req.params.id;
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

module.exports = { list, markRead, getPreferences, updatePreferences };
