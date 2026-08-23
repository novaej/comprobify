const { addMonths } = require('../../../src/utils/add-months');

const iso = (d) => d.toISOString().slice(0, 10);
const at = (s) => new Date(`${s}T12:00:00Z`);

describe('addMonths', () => {
  describe('ordinary dates', () => {
    test.each([
      ['2026-02-15', 1, '2026-03-15'],
      ['2026-06-01', 1, '2026-07-01'],
      ['2026-12-15', 1, '2027-01-15'],
      ['2026-06-15', 12, '2027-06-15'],
    ])('%s + %i month(s) = %s', (from, months, expected) => {
      expect(iso(addMonths(at(from), months))).toBe(expected);
    });
  });

  // The bug this helper exists for: setUTCMonth() normalizes an out-of-range
  // day rather than rejecting it, so "Jan 31 + 1 month" became "Feb 31" =
  // Mar 3 — a free extra month, which then compounded because each renewal
  // anchors to the previous (already drifted) period end.
  describe('month-end clamping', () => {
    test.each([
      ['2026-01-31', 1, '2026-02-28'],
      ['2026-01-30', 1, '2026-02-28'],
      ['2026-01-29', 1, '2026-02-28'],
      ['2026-03-31', 1, '2026-04-30'],
      ['2026-05-31', 1, '2026-06-30'],
      ['2026-08-31', 1, '2026-09-30'],
      ['2026-10-31', 1, '2026-11-30'],
    ])('%s + %i month(s) clamps to %s', (from, months, expected) => {
      expect(iso(addMonths(at(from), months))).toBe(expected);
    });

    test('Jan 31 lands on Feb 29 in a leap year', () => {
      expect(iso(addMonths(at('2028-01-31'), 1))).toBe('2028-02-29');
    });

    test('Feb 29 + 12 months clamps to Feb 28 in the following non-leap year', () => {
      expect(iso(addMonths(at('2028-02-29'), 12))).toBe('2029-02-28');
    });

    // A 31st that lands on another 31-day month must NOT be clamped.
    test('a 31st is preserved when the target month has 31 days', () => {
      expect(iso(addMonths(at('2026-01-31'), 2))).toBe('2026-03-31');
      expect(iso(addMonths(at('2026-07-31'), 1))).toBe('2026-08-31');
    });
  });

  test('preserves the time of day, including milliseconds', () => {
    expect(addMonths(new Date('2026-01-31T08:45:13.500Z'), 1).toISOString())
      .toBe('2026-02-28T08:45:13.500Z');
  });

  test('does not mutate the input date', () => {
    const from = new Date('2026-01-31T12:00:00Z');
    addMonths(from, 1);
    expect(from.toISOString()).toBe('2026-01-31T12:00:00.000Z');
  });

  // Anchoring guarantee: N successive single-month steps must not drift the
  // day-of-month permanently once a clamp has happened — a subscription that
  // renews off the 31st should settle on month-end, not creep forward.
  test('successive steps from a 31st do not creep forward', () => {
    let d = at('2026-01-31');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      d = addMonths(d, 1);
      seen.push(iso(d));
    }
    expect(seen).toEqual(['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28']);
  });
});
