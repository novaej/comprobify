jest.mock('../../../src/models/tenant-quota.model');

const tenantQuotaModel = require('../../../src/models/tenant-quota.model');
const tenantQuotaService = require('../../../src/services/tenant-quota.service');
const QuotaExceededError = require('../../../src/errors/quota-exceeded-error');

describe('TenantQuotaService', () => {
  afterEach(() => jest.clearAllMocks());

  describe('setCap', () => {
    test('does nothing when the tenant has no current period', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue(null);

      const result = await tenantQuotaService.setCap('tenant-1', 'GROWTH', 'MONTHLY');

      expect(result).toBeNull();
      expect(tenantQuotaModel.updateCapAndInterval).not.toHaveBeenCalled();
    });

    test('MONTHLY: caps at the tier\'s flat documentQuota and period_end stays +1 month from period_start', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue({
        period_start: new Date('2026-03-05T00:00:00.000Z'),
      });

      await tenantQuotaService.setCap('tenant-1', 'GROWTH', 'MONTHLY');

      expect(tenantQuotaModel.updateCapAndInterval).toHaveBeenCalledWith(
        'tenant-1', 1000, 'MONTHLY', new Date('2026-04-05T00:00:00.000Z')
      );
    });

    // The core of the yearly-pooling feature: a YEARLY subscriber's cap is
    // documentQuota x 12, consumable unevenly across a real 12-month window,
    // not reset every 30 days.
    test('YEARLY: pools documentQuota x 12 and extends period_end to +12 months', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue({
        period_start: new Date('2026-03-05T00:00:00.000Z'),
      });

      await tenantQuotaService.setCap('tenant-1', 'GROWTH', 'YEARLY');

      expect(tenantQuotaModel.updateCapAndInterval).toHaveBeenCalledWith(
        'tenant-1', 12000, 'YEARLY', new Date('2027-03-05T00:00:00.000Z')
      );
    });

    // ENTERPRISE is genuinely unlimited (null), not a large sentinel — no
    // multiplier ever applies to it, YEARLY included.
    test('ENTERPRISE stays null (unlimited) regardless of billing interval', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue({
        period_start: new Date('2026-01-01T00:00:00.000Z'),
      });

      await tenantQuotaService.setCap('tenant-1', 'ENTERPRISE', 'YEARLY');

      expect(tenantQuotaModel.updateCapAndInterval).toHaveBeenCalledWith(
        'tenant-1', null, 'YEARLY', new Date('2027-01-01T00:00:00.000Z')
      );
    });

    // FREE never pools annually even if a stale/leftover YEARLY interval is
    // passed through (e.g. a downgrade-to-FREE call site) — there is no live
    // YEARLY+FREE subscription in practice, but the guard is defensive.
    test('FREE never pools annually even if YEARLY is passed', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue({
        period_start: new Date('2026-01-01T00:00:00.000Z'),
      });

      await tenantQuotaService.setCap('tenant-1', 'FREE', 'YEARLY');

      expect(tenantQuotaModel.updateCapAndInterval).toHaveBeenCalledWith(
        'tenant-1', 5, 'MONTHLY', new Date('2026-02-01T00:00:00.000Z')
      );
    });

    // Regression guard for the `?? ` vs `||` nullish-coalescing bug: an
    // unrecognized tier string must fall back to FREE, but ENTERPRISE's own
    // legitimate null cap must never be mistaken for "unrecognized tier".
    test('an unrecognized tier falls back to FREE\'s cap, not null', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue({
        period_start: new Date('2026-01-01T00:00:00.000Z'),
      });

      await tenantQuotaService.setCap('tenant-1', 'NOT_A_REAL_TIER', 'MONTHLY');

      expect(tenantQuotaModel.updateCapAndInterval).toHaveBeenCalledWith(
        'tenant-1', 5, 'MONTHLY', new Date('2026-02-01T00:00:00.000Z')
      );
    });

    // Same month-end overflow class of bug addMonths() exists to prevent for
    // subscription periods (CLAUDE.md Common Mistake #26) — must not
    // regress here just because the anchor moved to tenant_quotas.
    test('a period_start on the 31st clamps to month-end instead of overflowing', async () => {
      tenantQuotaModel.findCurrentByTenantId.mockResolvedValue({
        period_start: new Date('2025-12-31T12:00:00.000Z'),
      });

      await tenantQuotaService.setCap('tenant-1', 'GROWTH', 'MONTHLY');

      const [, , , periodEnd] = tenantQuotaModel.updateCapAndInterval.mock.calls[0];
      expect(periodEnd).toEqual(new Date('2026-01-31T12:00:00.000Z'));
    });
  });

  describe('consumeOne', () => {
    test('throws QuotaExceededError when the model reports at-cap', async () => {
      tenantQuotaModel.incrementIfWithinCap.mockResolvedValue(false);

      await expect(tenantQuotaService.consumeOne({}, 'tenant-1')).rejects.toThrow(QuotaExceededError);
    });

    test('resolves when the model reports the increment happened', async () => {
      tenantQuotaModel.incrementIfWithinCap.mockResolvedValue(true);

      await expect(tenantQuotaService.consumeOne({}, 'tenant-1')).resolves.toBeUndefined();
    });
  });

  describe('resetDuePeriods', () => {
    test('MONTHLY row rolls into another 1-month period at the flat cap', async () => {
      tenantQuotaModel.findDueForReset.mockResolvedValue([{
        tenant_id: 'tenant-1', subscription_tier: 'STARTER', billing_interval: 'MONTHLY',
        period_end: new Date('2026-03-01T00:00:00.000Z'),
      }]);

      const result = await tenantQuotaService.resetDuePeriods();

      expect(tenantQuotaModel.rollover).toHaveBeenCalledWith(
        'tenant-1',
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
        200,
        'MONTHLY'
      );
      expect(result).toEqual({ quotaPeriodsReset: 1 });
    });

    // A YEARLY row still mid-year (billing_interval carried on the row
    // itself, not re-derived from subscriptions) rolls into ANOTHER 12-month
    // pool, not a 1-month one — this is what keeps the annual pool from
    // silently reverting to monthly on whatever day this cron happens to run.
    test('YEARLY row rolls into another 12-month pooled period', async () => {
      tenantQuotaModel.findDueForReset.mockResolvedValue([{
        tenant_id: 'tenant-2', subscription_tier: 'GROWTH', billing_interval: 'YEARLY',
        period_end: new Date('2026-01-01T00:00:00.000Z'),
      }]);

      await tenantQuotaService.resetDuePeriods();

      expect(tenantQuotaModel.rollover).toHaveBeenCalledWith(
        'tenant-2',
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2027-01-01T00:00:00.000Z'),
        12000,
        'YEARLY'
      );
    });

    test('a row with no billing_interval defaults to MONTHLY', async () => {
      tenantQuotaModel.findDueForReset.mockResolvedValue([{
        tenant_id: 'tenant-3', subscription_tier: 'FREE', billing_interval: null,
        period_end: new Date('2026-03-01T00:00:00.000Z'),
      }]);

      await tenantQuotaService.resetDuePeriods();

      expect(tenantQuotaModel.rollover).toHaveBeenCalledWith(
        'tenant-3',
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
        5,
        'MONTHLY'
      );
    });
  });
});
