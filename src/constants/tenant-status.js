// PAST_DUE is deliberately distinct from SUSPENDED — SUSPENDED is always
// admin-lifted (fraud, ToS violation, voluntary closure); PAST_DUE is a
// purely automated, self-resolving billing state assigned by
// subscriptionService.expireSubscription() when a renewal grace period
// lapses. A PAST_DUE tenant can pay their way back to ACTIVE without any
// admin involvement (see src/middleware/require-past-due.js and
// activateIfLinked's PAST_DUE -> ACTIVE recovery step) — a SUSPENDED tenant
// cannot. See docs/adr/025-past-due-tenant-status.md.
const TenantStatus = Object.freeze({
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE:               'ACTIVE',
  SUSPENDED:            'SUSPENDED',
  PAST_DUE:             'PAST_DUE',
});

module.exports = TenantStatus;
