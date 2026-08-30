// Mirrors the chk_payments_method CHECK (migrations 052, 091) — update both.
const PaymentMethods = Object.freeze({
  SPI_TRANSFER:  'SPI_TRANSFER',
  PAYPHONE_CARD: 'PAYPHONE_CARD',
});

module.exports = PaymentMethods;
