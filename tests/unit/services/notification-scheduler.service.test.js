jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/notification-preference.model');
jest.mock('../../../src/services/webhook-delivery.service');
jest.mock('../../../src/services/notification.service');

const tenantModel = require('../../../src/models/tenant.model');
const notificationPreferenceModel = require('../../../src/models/notification-preference.model');
const webhookDeliveryService = require('../../../src/services/webhook-delivery.service');
const notificationService = require('../../../src/services/notification.service');
const notificationSchedulerService = require('../../../src/services/notification-scheduler.service');

describe('NotificationSchedulerService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runAll', () => {
    test('returns zero tenants checked and the retry summary when there are no active tenants', async () => {
      tenantModel.findAllActive.mockResolvedValue([]);
      webhookDeliveryService.processDueRetries.mockResolvedValue({
        attempted: 0, succeeded: 0, failed: 0, exhausted: 0,
      });

      const result = await notificationSchedulerService.runAll();

      expect(notificationPreferenceModel.findByTenantId).not.toHaveBeenCalled();
      expect(notificationService.runCertChecksForTenant).not.toHaveBeenCalled();
      expect(result).toEqual({
        tenantsChecked: 0,
        retries: { attempted: 0, succeeded: 0, failed: 0, exhausted: 0 },
      });
    });

    test('runs cert checks for every active tenant using their notification preferences', async () => {
      tenantModel.findAllActive.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      notificationPreferenceModel.findByTenantId.mockImplementation((tenantId) =>
        Promise.resolve({ CERT_EXPIRING: tenantId === 1 }));
      notificationService.runCertChecksForTenant.mockResolvedValue(undefined);
      webhookDeliveryService.processDueRetries.mockResolvedValue({
        attempted: 3, succeeded: 2, failed: 1, exhausted: 0,
      });

      const result = await notificationSchedulerService.runAll();

      expect(notificationPreferenceModel.findByTenantId).toHaveBeenCalledWith(1);
      expect(notificationPreferenceModel.findByTenantId).toHaveBeenCalledWith(2);
      expect(notificationService.runCertChecksForTenant).toHaveBeenCalledWith(1, { CERT_EXPIRING: true });
      expect(notificationService.runCertChecksForTenant).toHaveBeenCalledWith(2, { CERT_EXPIRING: false });
      expect(result).toEqual({
        tenantsChecked: 2,
        retries: { attempted: 3, succeeded: 2, failed: 1, exhausted: 0 },
      });
    });

    test('continues past a tenant whose cert check throws, without counting it as checked', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      tenantModel.findAllActive.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      notificationPreferenceModel.findByTenantId.mockResolvedValue({});
      notificationService.runCertChecksForTenant.mockImplementation((tenantId) => {
        if (tenantId === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve(undefined);
      });
      webhookDeliveryService.processDueRetries.mockResolvedValue({
        attempted: 0, succeeded: 0, failed: 0, exhausted: 0,
      });

      const result = await notificationSchedulerService.runAll();

      expect(notificationService.runCertChecksForTenant).toHaveBeenCalledTimes(2);
      expect(result.tenantsChecked).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cert check failed for tenant 1'),
        'boom'
      );

      consoleErrorSpy.mockRestore();
    });

    test('propagates the webhook retry summary from webhookDeliveryService', async () => {
      tenantModel.findAllActive.mockResolvedValue([]);
      const retries = { attempted: 5, succeeded: 4, failed: 1, exhausted: 2 };
      webhookDeliveryService.processDueRetries.mockResolvedValue(retries);

      const result = await notificationSchedulerService.runAll();

      expect(webhookDeliveryService.processDueRetries).toHaveBeenCalledWith();
      expect(result.retries).toBe(retries);
    });
  });
});
