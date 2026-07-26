const NotificationTypes = require('./notification-types');

/**
 * Notification types that cannot be individually subscribed to — sent to
 * every tenant on every channel regardless of preference. No
 * notification_preferences row may ever exist for one of these (rejected at
 * the validator layer, src/routes/notifications.routes.js) and their
 * notifications row is created unconditionally (see e.g.
 * notification.service.js's createPriceChangeAnnounced).
 *
 * This is a preview of the "mandatory" flag NEXT_STEPS.md item 13 plans to
 * add to a richer per-type catalog (capability flags for email/in-app +
 * mandatory) — tracked here as a plain list until that lands, rather than
 * building the full catalog object for one type.
 */
module.exports = Object.freeze([
  NotificationTypes.PRICE_CHANGE_ANNOUNCED,
]);
