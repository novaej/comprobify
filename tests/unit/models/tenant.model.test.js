jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const tenantModel = require('../../../src/models/tenant.model');

describe('TenantModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  describe('findAllNotifiableForPriceChanges', () => {
    test('selects ACTIVE tenants plus PENDING_VERIFICATION ones with a live subscription', async () => {
      await tenantModel.findAllNotifiableForPriceChanges();

      const [sql, values] = db.query.mock.calls[0];
      expect(values).toEqual(['ACTIVE', 'PENDING_VERIFICATION']);
      expect(sql).toMatch(/t\.status = \$1/);
      expect(sql).toMatch(/t\.status = \$2 AND EXISTS/);
      expect(sql).toMatch(/s\.status = 'ACTIVE'/);
    });

    test('never selects SUSPENDED or PAST_DUE tenants (reactivation catch-up covers them)', async () => {
      await tenantModel.findAllNotifiableForPriceChanges();

      const [sql, values] = db.query.mock.calls[0];
      expect(values).not.toContain('SUSPENDED');
      expect(values).not.toContain('PAST_DUE');
      expect(sql).not.toMatch(/SUSPENDED|PAST_DUE/);
    });
  });
});
