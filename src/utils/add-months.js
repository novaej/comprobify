// Adds whole months to a date, clamping to the last day of the target month
// instead of overflowing into the next one.
//
// Date.setUTCMonth() silently normalizes an out-of-range day: Jan 31 + 1 month
// becomes "Feb 31", which is Mar 3. Both billing-period call sites hit this —
// a subscription or quota period anchored to the 29th–31st handed the customer
// an extra month, and because each renewal anchors to the previous (already
// drifted) period end, the anniversary shifted permanently rather than
// self-correcting. Clamping to month-end is the convention every billing
// system uses.
//
//   2026-01-31 + 1 month -> 2026-02-28   (was 2026-03-03)
//   2026-03-31 + 1 month -> 2026-04-30   (was 2026-05-01)
//   2028-02-29 + 12 months -> 2029-02-28 (was 2029-03-01)
//
// UTC deliberately: these are TIMESTAMPTZ instants and the result must not
// depend on the server's timezone. Production containers run UTC (no TZ is set
// in the Dockerfile, and node:20-slim defaults to it), so this matches what
// production already computed — it only makes non-UTC development machines
// agree with it.
function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  // A changed day-of-month is the overflow signal; day 0 is the last day of
  // the previous month, i.e. the one actually intended.
  if (next.getUTCDate() !== day) next.setUTCDate(0);
  return next;
}

module.exports = { addMonths };
