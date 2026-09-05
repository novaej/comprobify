jest.mock('fs');
jest.mock('../../../src/models/notification-email-template.model');

const fs = require('fs');
const notificationEmailTemplateModel = require('../../../src/models/notification-email-template.model');
const config = require('../../../src/config');
const notificationEmailTemplateService = require('../../../src/services/notification-email-template.service');

const SOURCE = `SUBJECT: Your {{tier}} subscription renews soon
---HTML---
<p>Hello, {{tier}} renews on {{dueDate}}.</p>
---TEXT---
Hello, {{tier}} renews on {{dueDate}}.
`;

describe('NotificationEmailTemplateService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('publish', () => {
    test('reads the source file, parses SUBJECT/HTML/TEXT sections, creates, and activates', async () => {
      fs.readFileSync.mockReturnValue(SOURCE);
      notificationEmailTemplateModel.create.mockResolvedValue({ id: 't1', notification_type: 'SUBSCRIPTION_RENEWAL_DUE', language: 'en', version: '1.0' });
      notificationEmailTemplateModel.activate.mockResolvedValue({ id: 't1', is_current: true });

      const result = await notificationEmailTemplateService.publish('SUBSCRIPTION_RENEWAL_DUE', 'en', '1.0');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('docs/email-templates/SUBSCRIPTION_RENEWAL_DUE.en.txt'), 'utf8'
      );
      const [createArgs] = notificationEmailTemplateModel.create.mock.calls[0];
      expect(createArgs.notificationType).toBe('SUBSCRIPTION_RENEWAL_DUE');
      expect(createArgs.language).toBe('en');
      expect(createArgs.version).toBe('1.0');
      expect(createArgs.subjectTemplate).toBe('Your {{tier}} subscription renews soon');
      expect(createArgs.htmlTemplate).toBe('<p>Hello, {{tier}} renews on {{dueDate}}.</p>');
      expect(createArgs.textTemplate).toBe('Hello, {{tier}} renews on {{dueDate}}.');
      expect(notificationEmailTemplateModel.activate).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ id: 't1', notification_type: 'SUBSCRIPTION_RENEWAL_DUE', language: 'en', version: '1.0' });
    });

    test('uses rawContent instead of reading the filesystem when supplied', async () => {
      notificationEmailTemplateModel.create.mockResolvedValue({ id: 't2' });
      notificationEmailTemplateModel.activate.mockResolvedValue({ id: 't2', is_current: true });

      await notificationEmailTemplateService.publish('SUBSCRIPTION_EXPIRED', 'es', '1.0', SOURCE);

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(notificationEmailTemplateModel.create).toHaveBeenCalled();
    });

    test('throws NOTIFICATION_TEMPLATE_MALFORMED when SUBJECT: header is missing', async () => {
      fs.readFileSync.mockReturnValue('no subject here\n---HTML---\n<p>x</p>\n---TEXT---\nx');

      await expect(notificationEmailTemplateService.publish('SUBSCRIPTION_EXPIRED', 'es', '1.0'))
        .rejects.toMatchObject({ statusCode: 500, code: 'NOTIFICATION_TEMPLATE_MALFORMED' });
      expect(notificationEmailTemplateModel.create).not.toHaveBeenCalled();
    });

    test('throws NOTIFICATION_TEMPLATE_MALFORMED when the HTML/TEXT sections are missing', async () => {
      fs.readFileSync.mockReturnValue('SUBJECT: hi\nno sections here');

      await expect(notificationEmailTemplateService.publish('SUBSCRIPTION_EXPIRED', 'es', '1.0'))
        .rejects.toMatchObject({ statusCode: 500, code: 'NOTIFICATION_TEMPLATE_MALFORMED' });
    });
  });

  describe('activateVersion / getById / getCurrent', () => {
    test('activateVersion throws NotFoundError when the model returns null', async () => {
      notificationEmailTemplateModel.activate.mockResolvedValue(null);

      await expect(notificationEmailTemplateService.activateVersion('missing'))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOTIFICATION_TEMPLATE_NOT_FOUND' });
    });

    test('getById throws NotFoundError when the model returns null', async () => {
      notificationEmailTemplateModel.findById.mockResolvedValue(null);

      await expect(notificationEmailTemplateService.getById('missing'))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOTIFICATION_TEMPLATE_NOT_FOUND' });
    });
  });

  describe('render', () => {
    const notification = {
      tenant_id: 'tenant-1',
      type: 'PAYMENT_REJECTED',
      metadata: {
        purpose: 'RENEWAL', tier: 'STARTER', billingInterval: 'MONTHLY',
        amount: 19, rejectionReasonCode: 'TRANSFER_NOT_FOUND',
      },
    };
    const template = {
      subject_template: '{{purposeLabel}} for {{tier}}',
      html_template: '<p>{{amount}} — {{reasonLabel}}</p>',
      text_template: '{{amount}} - {{reasonLabel}}',
    };

    test('resolves the current template for the requested language and substitutes computed values', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue(template);

      const result = await notificationEmailTemplateService.render('PAYMENT_REJECTED', 'en', notification);

      expect(notificationEmailTemplateModel.findCurrent).toHaveBeenCalledWith('PAYMENT_REJECTED', 'en');
      expect(result.subject).toBe('renewal for STARTER');
      expect(result.text).toBe('19.00 - No matching transfer was found in the account.');
      expect(result.html).toBe('<p>19.00 — No matching transfer was found in the account.</p>');
    });

    test('falls back to the default language (es) when the requested language has no published template', async () => {
      notificationEmailTemplateModel.findCurrent
        .mockResolvedValueOnce(null) // en: not found
        .mockResolvedValueOnce({ ...template, subject_template: '{{purposeLabel}} — {{tier}}' }); // es: found

      const result = await notificationEmailTemplateService.render('PAYMENT_REJECTED', 'en', notification);

      expect(notificationEmailTemplateModel.findCurrent).toHaveBeenNthCalledWith(1, 'PAYMENT_REJECTED', 'en');
      expect(notificationEmailTemplateModel.findCurrent).toHaveBeenNthCalledWith(2, 'PAYMENT_REJECTED', 'es');
      expect(result.subject).toBe('renovación — STARTER');
    });

    test('PAYMENT_VERIFIED/REJECTED with no stored pricing_breakdown substitutes an empty breakdownText (INITIAL/RENEWAL never set one)', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: 'x', html_template: '<p>Detail: {{breakdownText}}</p>', text_template: 'Detail: {{breakdownText}}',
      });

      const result = await notificationEmailTemplateService.render('PAYMENT_REJECTED', 'en', notification);

      expect(result.text).toBe('Detail: ');
    });

    test('CROSS_INTERVAL_UPGRADE breakdown renders plan + seats + credit as separate lines', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: 'x', html_template: '{{breakdownText}}', text_template: '{{breakdownText}}',
      });
      const verifiedNotification = {
        tenant_id: 'tenant-1', type: 'PAYMENT_VERIFIED',
        metadata: {
          purpose: 'TIER_CHANGE', tier: 'ENTERPRISE', billingInterval: 'YEARLY', amount: 4427.27,
          pricingBreakdown: {
            model: 'CROSS_INTERVAL_UPGRADE', newTierPrice: 4500, seatsCount: 3, seatPrice: 50,
            seatsCost: 150, fullPrice: 4650, previousPlanPrice: 230, remainingFraction: 0.9678, credit: 222.73, proratedBase: 4427.27,
          },
        },
      };

      const result = await notificationEmailTemplateService.render('PAYMENT_VERIFIED', 'en', verifiedNotification);

      expect(result.text).toBe(
        'How this was calculated:\nNew plan: $4500.00\nExtra seats (3 x $50.00): $150.00\nSubtotal: $4650.00\nCredit for unused time on your current plan: -$222.73'
      );
    });

    test('SAME_INTERVAL_UPGRADE breakdown localizes to Spanish', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: 'x', html_template: '{{breakdownText}}', text_template: '{{breakdownText}}',
      });
      const verifiedNotification = {
        tenant_id: 'tenant-1', type: 'PAYMENT_VERIFIED',
        metadata: {
          purpose: 'TIER_CHANGE', tier: 'GROWTH', billingInterval: 'MONTHLY', amount: 35,
          pricingBreakdown: { model: 'SAME_INTERVAL_UPGRADE', currentTierPrice: 20, newTierPrice: 90, priceDifference: 70, remainingFraction: 0.5, proratedBase: 35 },
        },
      };

      const result = await notificationEmailTemplateService.render('PAYMENT_VERIFIED', 'es', verifiedNotification);

      expect(result.text).toBe('Detalle del cálculo:\nPlan actual: $20.00\nPlan nuevo: $90.00\nDiferencia prorrateada (50.0% del período restante): $35.00');
    });

    test('throws NotFoundError when neither the requested nor the default language has a published template', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue(null);

      await expect(notificationEmailTemplateService.render('PAYMENT_REJECTED', 'en', notification))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOTIFICATION_TEMPLATE_NOT_FOUND' });
    });

    test('SUBSCRIPTION_RENEWAL_DUE values include the operator bank transfer config, not per-notification data', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: 'Renews soon',
        html_template: '{{bankName}} / {{accountNumber}}',
        text_template: '{{bankName}} / {{accountNumber}}',
      });
      const renewalNotification = {
        tenant_id: 'tenant-1', type: 'SUBSCRIPTION_RENEWAL_DUE',
        metadata: { tier: 'GROWTH', currentPeriodEnd: new Date('2026-08-06T00:00:00Z'), amount: 79, paymentId: 'payment-1' },
      };

      const result = await notificationEmailTemplateService.render('SUBSCRIPTION_RENEWAL_DUE', 'es', renewalNotification);

      expect(result.text).toBe(`${config.bankTransfer.bankName} / ${config.bankTransfer.accountNumber}`);
    });

    test('SUBSCRIPTION_PAST_DUE_WARNING values include a formatted suspendsAt date', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: '{{tier}} past due',
        html_template: 'Pay by {{suspendsAt}}',
        text_template: 'Pay by {{suspendsAt}}',
      });
      const warningNotification = {
        tenant_id: 'tenant-1', type: 'SUBSCRIPTION_PAST_DUE_WARNING',
        metadata: { subscriptionId: 'sub-1', tier: 'STARTER', currentPeriodEnd: new Date('2026-07-01T12:00:00Z'), suspendsAt: new Date('2026-07-08T12:00:00Z') },
      };

      const result = await notificationEmailTemplateService.render('SUBSCRIPTION_PAST_DUE_WARNING', 'es', warningNotification);

      expect(result.subject).toBe('STARTER past due');
      expect(result.text).toBe('Pay by 08/07/2026');
    });

    test('PRICE_CHANGE_ANNOUNCED for a real tier substitutes the tier name', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: 'Price change: {{tier}}',
        html_template: '{{tier}} — ${{currentPrice}} -> ${{newPrice}}',
        text_template: '{{tier}} — ${{currentPrice}} -> ${{newPrice}}',
      });
      const tierPriceNotification = {
        tenant_id: 'tenant-1', type: 'PRICE_CHANGE_ANNOUNCED',
        metadata: { tierPriceId: 'tp-1', tier: 'GROWTH', billingInterval: 'MONTHLY', previousPriceUsd: 90, newPriceUsd: 100, effectiveAt: new Date('2026-10-01') },
      };

      const result = await notificationEmailTemplateService.render('PRICE_CHANGE_ANNOUNCED', 'en', tierPriceNotification);

      expect(result.subject).toBe('Price change: GROWTH');
    });

    // Regression test: a seat-price notification's metadata has no `tier`
    // key at all (only seatPriceId) — without the buildValues branch, {{tier}}
    // would render literally in the email instead of being substituted.
    test('PRICE_CHANGE_ANNOUNCED for the seat add-on substitutes an item label, not a literal {{tier}}', async () => {
      notificationEmailTemplateModel.findCurrent.mockResolvedValue({
        subject_template: 'Price change: {{tier}}',
        html_template: '{{tier}} — ${{currentPrice}} -> ${{newPrice}}',
        text_template: '{{tier}} — ${{currentPrice}} -> ${{newPrice}}',
      });
      const seatPriceNotification = {
        tenant_id: 'tenant-1', type: 'PRICE_CHANGE_ANNOUNCED',
        metadata: { seatPriceId: 'sp-1', billingInterval: 'MONTHLY', previousPriceUsd: 5, newPriceUsd: 6, effectiveAt: new Date('2026-10-01') },
      };

      const resultEn = await notificationEmailTemplateService.render('PRICE_CHANGE_ANNOUNCED', 'en', seatPriceNotification);
      expect(resultEn.subject).toBe('Price change: Extra user seats');
      expect(resultEn.subject).not.toContain('{{tier}}');

      const resultEs = await notificationEmailTemplateService.render('PRICE_CHANGE_ANNOUNCED', 'es', seatPriceNotification);
      expect(resultEs.subject).toBe('Price change: Usuarios adicionales');
    });
  });
});
