// How a payment reaches us. Mirrors the chk_payments_method CHECK constraint
// (migrations 052 and 091) — adding a value means updating both, the same
// two-places-to-update rule as every other enum in this codebase.
//
// SPI_TRANSFER is the manual path: the tenant uploads proof of a bank transfer
// and the operator verifies it by hand. PAYPHONE_CARD verifies itself the
// moment Payphone confirms the charge, with no human in the loop — which is
// why it's the only method that emails the operator (see ADR-028).
const PaymentMethods = Object.freeze({
  SPI_TRANSFER:  'SPI_TRANSFER',
  PAYPHONE_CARD: 'PAYPHONE_CARD',
});

module.exports = PaymentMethods;
