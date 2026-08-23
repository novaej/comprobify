// Why a tenant was moved to SUSPENDED. A predefined enum rather than free
// text because GET /v1/tenants/events passes tenant_events.detail through
// verbatim — anything stored here is readable by whoever holds that tenant's
// API key, so the frontend must map a stable code to its own localized copy
// instead of displaying whatever an operator typed. Same reasoning (and same
// shape) as RejectionReasons; see db/migrations/090.
//
// VOLUNTARY_CLOSURE is not punitive: the product has no separate "closed"
// status, so an account-closure request (terms-of-service.md §10) lands in
// SUSPENDED too and must not be worded like a sanction.
const SuspensionReasons = Object.freeze({
  PAYMENT_REVERSED:  'PAYMENT_REVERSED',
  FRAUD_SUSPECTED:   'FRAUD_SUSPECTED',
  TERMS_VIOLATION:   'TERMS_VIOLATION',
  VOLUNTARY_CLOSURE: 'VOLUNTARY_CLOSURE',
  UNPAID_BALANCE:    'UNPAID_BALANCE',
  OTHER:             'OTHER',
});

module.exports = SuspensionReasons;
