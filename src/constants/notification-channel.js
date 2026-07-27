/**
 * Delivery channels a notification type can support. Used by
 * notification-catalog.js (capability flags) and notification_preferences'
 * `channel` column (migration 077).
 */
const NotificationChannel = Object.freeze({
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
});

module.exports = NotificationChannel;
