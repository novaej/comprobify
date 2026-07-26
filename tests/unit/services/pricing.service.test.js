jest.mock('../../../src/models/tier-price.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/services/pending-effect.service');
jest.mock('../../../src/services/notification.service');

const tierPriceModel = require('../../../src/models/tier-price.model');
const tenantModel = require('../../../src/models/tenant.model');
const pendingEffectService = require('../../../src/services/pending-effect.service');
const notificationService = require('../../../src/services/notification.service');
const pricingService = require('../../../src/services/pricing.service');

describe('PricingService', () => {
  beforeEach(() => {
    pendingEffectService.enqueue.mockResolvedValue({ id: 'effect-x', effect_type: 'X' });
    pendingEffectService.dispatch.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPriceAsOf / getCurrentPrice', () => {
    test('rejects an invalid tier', async () => {
      await expect(pricingService.getCurrentPrice('NOT_A_TIER', 'MONTHLY'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIER' });
    });

    test('rejects an invalid billingInterval', async () => {
      await expect(pricingService.getCurrentPrice('STARTER', 'WEEKLY'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BILLING_INTERVAL' });
    });

    test('resolves the newest PUBLISHED row effective as of the given date', async () => {
      tierPriceModel.findCurrent.mockResolvedValue({ price_usd: '25.00' });

      const price = await pricingService.getPriceAsOf('STARTER', 'MONTHLY', new Date('2026-08-01'));

      expect(tierPriceModel.findCurrent).toHaveBeenCalledWith('STARTER', 'MONTHLY', new Date('2026-08-01'));
      expect(price).toBe(25);
    });

    test('throws if no published price exists as of the given date', async () => {
      tierPriceModel.findCurrent.mockResolvedValue(null);

      await expect(pricingService.getPriceAsOf('STARTER', 'MONTHLY', new Date()))
        .rejects.toMatchObject({ code: 'PRICE_NOT_FOUND' });
    });

    test('a renewal priced before a new price\'s effective_at still resolves the old price', async () => {
      // Simulates the 30-day protection: findCurrent is asOfDate-aware, so the
      // resolver naturally returns whatever was PUBLISHED and effective on
      // that date — the caller (subscription.service.js) is what supplies
      // current_period_end as asOfDate instead of "now".
      tierPriceModel.findCurrent.mockImplementation(async (tier, interval, asOfDate) => {
        const newPriceEffectiveAt = new Date('2026-09-01');
        return asOfDate < newPriceEffectiveAt ? { price_usd: '20.00' } : { price_usd: '25.00' };
      });

      const beforeChange = await pricingService.getPriceAsOf('STARTER', 'MONTHLY', new Date('2026-08-15'));
      const afterChange = await pricingService.getPriceAsOf('STARTER', 'MONTHLY', new Date('2026-09-15'));

      expect(beforeChange).toBe(20);
      expect(afterChange).toBe(25);
    });
  });

  describe('getUpcoming', () => {
    test('returns null when nothing is pending', async () => {
      tierPriceModel.findUpcoming.mockResolvedValue(null);

      const result = await pricingService.getUpcoming('STARTER', 'MONTHLY');

      expect(result).toBeNull();
    });

    test('returns the price and effective date when a change is pending', async () => {
      tierPriceModel.findUpcoming.mockResolvedValue({ price_usd: '25.00', effective_at: new Date('2026-09-01') });

      const result = await pricingService.getUpcoming('STARTER', 'MONTHLY');

      expect(result).toEqual({ priceUsd: 25, effectiveAt: new Date('2026-09-01') });
    });
  });

  describe('createDraft / updateDraft', () => {
    test('createDraft rejects an invalid tier before touching the model', async () => {
      await expect(pricingService.createDraft({ tier: 'NOT_A_TIER', billingInterval: 'MONTHLY', priceUsd: 25 }))
        .rejects.toMatchObject({ code: 'INVALID_TIER' });
      expect(tierPriceModel.create).not.toHaveBeenCalled();
    });

    test('createDraft delegates to the model', async () => {
      tierPriceModel.create.mockResolvedValue({ id: 'p1', status: 'DRAFT' });

      const result = await pricingService.createDraft({ tier: 'STARTER', billingInterval: 'MONTHLY', priceUsd: 25 });

      expect(tierPriceModel.create).toHaveBeenCalledWith({ tier: 'STARTER', billingInterval: 'MONTHLY', priceUsd: 25 });
      expect(result).toEqual({ id: 'p1', status: 'DRAFT' });
    });

    test('updateDraft rejects with PRICE_NOT_DRAFT when the row is already PUBLISHED', async () => {
      tierPriceModel.updatePriceUsd.mockResolvedValue(null);
      tierPriceModel.findById.mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });

      await expect(pricingService.updateDraft('p1', 30))
        .rejects.toMatchObject({ statusCode: 400, code: 'PRICE_NOT_DRAFT' });
    });

    test('updateDraft throws NotFoundError when the row does not exist', async () => {
      tierPriceModel.updatePriceUsd.mockResolvedValue(null);
      tierPriceModel.findById.mockResolvedValue(null);

      await expect(pricingService.updateDraft('missing', 30))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('publishPrice', () => {
    test('rejects an explicit noticeDays below the configured floor', async () => {
      await expect(pricingService.publishPrice('p1', { noticeDays: 5 }))
        .rejects.toMatchObject({ statusCode: 400, code: 'PRICE_NOTICE_TOO_SHORT' });
      expect(tierPriceModel.publish).not.toHaveBeenCalled();
    });

    test('defaults to the configured floor (30 days) when noticeDays is omitted', async () => {
      tierPriceModel.publish.mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
      tenantModel.findAllByStatus.mockResolvedValue([]);

      await pricingService.publishPrice('p1');

      const [, effectiveAt] = tierPriceModel.publish.mock.calls[0];
      const daysFromNow = Math.round((effectiveAt - Date.now()) / (24 * 60 * 60 * 1000));
      expect(daysFromNow).toBe(30);
    });

    test('throws PRICE_NOT_DRAFT when the row is already PUBLISHED', async () => {
      tierPriceModel.publish.mockResolvedValue(null);
      tierPriceModel.findById.mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });

      await expect(pricingService.publishPrice('p1'))
        .rejects.toMatchObject({ statusCode: 400, code: 'PRICE_NOT_DRAFT' });
    });

    test('notifies every ACTIVE tenant after publishing, one at a time, tolerating per-tenant failure', async () => {
      tierPriceModel.publish.mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
      tenantModel.findAllByStatus.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]);
      tierPriceModel.findUnnotifiedPendingForTenant
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValueOnce([]);

      const result = await pricingService.publishPrice('p1');

      expect(tenantModel.findAllByStatus).toHaveBeenCalledWith('ACTIVE');
      expect(tierPriceModel.findUnnotifiedPendingForTenant).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 'p1', status: 'PUBLISHED' });
    });
  });

  describe('notifyPendingPriceChangesForTenant', () => {
    test('is a no-op when there is nothing pending — never even fetches the tenant', async () => {
      tierPriceModel.findUnnotifiedPendingForTenant.mockResolvedValue([]);

      const count = await pricingService.notifyPendingPriceChangesForTenant('tenant-1');

      expect(count).toBe(0);
      expect(tenantModel.findById).not.toHaveBeenCalled();
      expect(notificationService.createPriceChangeAnnounced).not.toHaveBeenCalled();
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
    });

    test('creates the in-app notification synchronously and queues only the email effect', async () => {
      tierPriceModel.findUnnotifiedPendingForTenant.mockResolvedValue([
        { id: 'price-1', tier: 'STARTER', billing_interval: 'MONTHLY' },
      ]);
      tenantModel.findById.mockResolvedValue({ id: 'tenant-1' });
      tierPriceModel.findCurrent.mockResolvedValue({ price_usd: '20.00' });

      const count = await pricingService.notifyPendingPriceChangesForTenant('tenant-1');

      expect(count).toBe(1);
      expect(notificationService.createPriceChangeAnnounced).toHaveBeenCalledWith(
        { id: 'tenant-1' },
        { id: 'price-1', tier: 'STARTER', billing_interval: 'MONTHLY' },
        20
      );
      expect(pendingEffectService.enqueue).toHaveBeenCalledTimes(1);
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('PRICE_CHANGE_EMAIL', 'tenant-1', { tenantId: 'tenant-1', tierPriceId: 'price-1', previousPriceUsd: 20 });
    });

    // No dedicated ledger — idempotency relies on PRICE_CHANGE_ANNOUNCED being
    // "mandatory" (created unconditionally) plus the in-app row being written
    // synchronously here, so a second call's findUnnotifiedPendingForTenant
    // (which queries notifications) naturally excludes it with no async gap.
    test('is idempotent — a second call with nothing newly pending does nothing more', async () => {
      tierPriceModel.findUnnotifiedPendingForTenant
        .mockResolvedValueOnce([{ id: 'price-1', tier: 'STARTER', billing_interval: 'MONTHLY' }])
        .mockResolvedValueOnce([]);
      tenantModel.findById.mockResolvedValue({ id: 'tenant-1' });
      tierPriceModel.findCurrent.mockResolvedValue({ price_usd: '20.00' });

      await pricingService.notifyPendingPriceChangesForTenant('tenant-1');
      const secondCallCount = await pricingService.notifyPendingPriceChangesForTenant('tenant-1');

      expect(secondCallCount).toBe(0);
      expect(notificationService.createPriceChangeAnnounced).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconcilePendingPriceChangeNotifications', () => {
    test('scans every ACTIVE tenant and reports how many needed catching up', async () => {
      tenantModel.findAllByStatus.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }, { id: 'tenant-3' }]);
      tenantModel.findById.mockResolvedValue({ id: 'tenant-x' });
      tierPriceModel.findCurrent.mockResolvedValue({ price_usd: '20.00' });
      tierPriceModel.findUnnotifiedPendingForTenant
        .mockResolvedValueOnce([{ id: 'price-1', tier: 'STARTER', billing_interval: 'MONTHLY' }]) // tenant-1: caught up
        .mockResolvedValueOnce([]) // tenant-2: nothing pending
        .mockResolvedValueOnce([{ id: 'price-1', tier: 'STARTER', billing_interval: 'MONTHLY' }]); // tenant-3: caught up

      const result = await pricingService.reconcilePendingPriceChangeNotifications();

      expect(tenantModel.findAllByStatus).toHaveBeenCalledWith('ACTIVE');
      expect(result).toEqual({ tenantsChecked: 3, notified: 2 });
    });

    test('tolerates one tenant failing without aborting the rest', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      tenantModel.findAllByStatus.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]);
      tierPriceModel.findUnnotifiedPendingForTenant
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValueOnce([]);

      const result = await pricingService.reconcilePendingPriceChangeNotifications();

      expect(tierPriceModel.findUnnotifiedPendingForTenant).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ tenantsChecked: 2, notified: 0 });

      consoleErrorSpy.mockRestore();
    });
  });
});
