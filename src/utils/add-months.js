// Adds whole months, clamping to month-end rather than overflowing:
// setUTCMonth() turns Jan 31 + 1 month into "Feb 31" = Mar 3, which handed
// billing periods anchored to the 29th-31st a free extra month. UTC so the
// result never depends on the server's timezone.
function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  // Changed day-of-month means it overflowed; day 0 is the intended month-end.
  if (next.getUTCDate() !== day) next.setUTCDate(0);
  return next;
}

module.exports = { addMonths };
