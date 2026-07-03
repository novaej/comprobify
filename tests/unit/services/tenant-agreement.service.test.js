jest.mock('../../../src/models/tenant-agreement.model');
jest.mock('../../../src/services/agreement.service');
jest.mock('../../../src/models/issuer.model');

const tenantAgreementModel = require('../../../src/models/tenant-agreement.model');
const agreementService = require('../../../src/services/agreement.service');
const issuerModel = require('../../../src/models/issuer.model');
const tenantAgreementService = require('../../../src/services/tenant-agreement.service');
const ErrorCodes = require('../../../src/constants/error-codes');

// Common stubs shared by tests that exercise generateForTenant's internal
// loop (directly, or indirectly via getStatus/hasAllAccepted/renderForTenant).
function stubSingleTemplateGeneration({ documentType = 'TERMS', version = 'v1', createdAt = new Date('2026-01-01') } = {}) {
  agreementService.listCurrent.mockResolvedValue([{ document_type: documentType, version }]);
  agreementService.getCurrent.mockResolvedValue({
    document_type: documentType,
    version,
    content_markdown: 'raw markdown',
    created_at: createdAt,
  });
  agreementService.substitutePlaceholders.mockReturnValue('rendered markdown');
  agreementService.computeHash.mockReturnValue('hash123');
  agreementService.formatDate.mockReturnValue('1 de enero de 2026');
}

describe('TenantAgreementService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateForTenant', () => {
    test('uses the provided issuer without looking one up', async () => {
      agreementService.listCurrent.mockResolvedValue([]);

      await tenantAgreementService.generateForTenant(1, { business_name: 'ACME' });

      expect(issuerModel.findByTenantId).not.toHaveBeenCalled();
    });

    test('looks up the tenant primary issuer when none is provided', async () => {
      agreementService.listCurrent.mockResolvedValue([]);
      issuerModel.findByTenantId.mockResolvedValue({ business_name: 'ACME' });

      await tenantAgreementService.generateForTenant(1);

      expect(issuerModel.findByTenantId).toHaveBeenCalledWith(1);
    });

    test('returns an empty array when there are no current templates', async () => {
      agreementService.listCurrent.mockResolvedValue([]);

      const result = await tenantAgreementService.generateForTenant(1, {});

      expect(result).toEqual([]);
      expect(tenantAgreementModel.create).not.toHaveBeenCalled();
    });

    test('generates a personalized, substituted instance per current template type', async () => {
      agreementService.listCurrent.mockResolvedValue([
        { document_type: 'TERMS' },
        { document_type: 'PRIVACY' },
      ]);
      agreementService.getCurrent.mockImplementation(async (documentType) => ({
        document_type: documentType,
        version: 'v1',
        content_markdown: 'raw markdown',
        created_at: new Date('2026-01-01'),
      }));
      agreementService.substitutePlaceholders.mockReturnValue('rendered markdown');
      agreementService.computeHash.mockReturnValue('hash123');
      agreementService.formatDate.mockReturnValue('1 de enero de 2026');
      tenantAgreementModel.create.mockResolvedValue({ id: 1 });

      const issuer = { business_name: 'ACME S.A.', ruc: '1712345678001', email: 'billing@acme.com' };
      const result = await tenantAgreementService.generateForTenant(5, issuer);

      expect(agreementService.substitutePlaceholders).toHaveBeenCalledWith('raw markdown', {
        fechaVersion: '1 de enero de 2026',
        fechaDocumento: '1 de enero de 2026',
        cliente: { razonSocial: 'ACME S.A.', ruc: '1712345678001', email: 'billing@acme.com' },
      });
      expect(tenantAgreementModel.create).toHaveBeenCalledWith({
        tenantId: 5,
        documentType: 'TERMS',
        templateVersion: 'v1',
        contentMarkdown: 'rendered markdown',
        contentHash: 'hash123',
      });
      expect(tenantAgreementModel.create).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'PRIVACY' }));
      expect(result).toEqual([{ id: 1 }, { id: 1 }]);
    });

    test('substitutes empty cliente fields when no issuer can be resolved', async () => {
      stubSingleTemplateGeneration();
      tenantAgreementModel.create.mockResolvedValue({ id: 2 });
      issuerModel.findByTenantId.mockResolvedValue(null);

      await tenantAgreementService.generateForTenant(5);

      expect(agreementService.substitutePlaceholders).toHaveBeenCalledWith(
        'raw markdown',
        expect.objectContaining({ cliente: { razonSocial: '', ruc: '', email: '' } })
      );
    });

    test('skips a row (does not include it in the result) when create returns null via ON CONFLICT DO NOTHING', async () => {
      stubSingleTemplateGeneration();
      tenantAgreementModel.create.mockResolvedValue(null);

      const result = await tenantAgreementService.generateForTenant(5, {});

      expect(result).toEqual([]);
    });
  });

  describe('validateTermsVersion', () => {
    test('resolves without throwing when nothing is published yet (AGREEMENT_NOT_FOUND)', async () => {
      const err = new Error('not found');
      err.code = ErrorCodes.AGREEMENT_NOT_FOUND;
      agreementService.getCurrent.mockRejectedValue(err);

      await expect(tenantAgreementService.validateTermsVersion('v1')).resolves.toBeUndefined();
    });

    test('rethrows errors unrelated to AGREEMENT_NOT_FOUND', async () => {
      const err = new Error('db is down');
      agreementService.getCurrent.mockRejectedValue(err);

      await expect(tenantAgreementService.validateTermsVersion('v1')).rejects.toThrow('db is down');
    });

    test('resolves without throwing when termsVersion matches the current published version', async () => {
      agreementService.getCurrent.mockResolvedValue({ version: 'v2' });

      await expect(tenantAgreementService.validateTermsVersion('v2')).resolves.toBeUndefined();
    });

    test('throws VERSION_MISMATCH when termsVersion does not match the current published version', async () => {
      agreementService.getCurrent.mockResolvedValue({ version: 'v2' });

      await expect(tenantAgreementService.validateTermsVersion('v1'))
        .rejects.toMatchObject({ statusCode: 400, code: 'VERSION_MISMATCH' });
    });
  });

  describe('acceptAll', () => {
    test('delegates to the model with ip/userAgent', async () => {
      tenantAgreementModel.acceptAllPendingByTenant.mockResolvedValue([{ id: 1, status: 'ACCEPTED' }]);

      const result = await tenantAgreementService.acceptAll(1, { ip: '1.2.3.4', userAgent: 'jest' });

      expect(tenantAgreementModel.acceptAllPendingByTenant).toHaveBeenCalledWith(1, { ip: '1.2.3.4', userAgent: 'jest' });
      expect(result).toEqual([{ id: 1, status: 'ACCEPTED' }]);
    });

    test('defaults ip/userAgent to undefined when no options are given', async () => {
      tenantAgreementModel.acceptAllPendingByTenant.mockResolvedValue([]);

      await tenantAgreementService.acceptAll(1);

      expect(tenantAgreementModel.acceptAllPendingByTenant).toHaveBeenCalledWith(1, { ip: undefined, userAgent: undefined });
    });
  });

  describe('getStatus', () => {
    test('returns needsAcceptance: false without generating anything when there are no current templates', async () => {
      agreementService.listCurrent.mockResolvedValue([]);

      const result = await tenantAgreementService.getStatus(1);

      expect(result).toEqual({ needsAcceptance: false, outdated: [] });
      expect(tenantAgreementModel.findLatestByTenantAndType).not.toHaveBeenCalled();
    });

    test('flags a type with no generated instance as NOT_GENERATED', async () => {
      stubSingleTemplateGeneration({ documentType: 'TERMS', version: 'v1' });
      issuerModel.findByTenantId.mockResolvedValue(null);
      tenantAgreementModel.create.mockResolvedValue({ id: 1 });
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue(null);

      const result = await tenantAgreementService.getStatus(1);

      expect(result).toEqual({
        needsAcceptance: true,
        outdated: [{
          documentType: 'TERMS',
          currentVersion: 'v1',
          acceptedVersion: null,
          status: 'NOT_GENERATED',
          url: '/v1/tenants/agreements/TERMS',
          acceptUrl: '/v1/tenants/agreements',
        }],
      });
    });

    test('excludes a type already ACCEPTED at the current version', async () => {
      stubSingleTemplateGeneration({ documentType: 'TERMS', version: 'v1' });
      issuerModel.findByTenantId.mockResolvedValue(null);
      tenantAgreementModel.create.mockResolvedValue(null); // already exists
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue({ template_version: 'v1', status: 'ACCEPTED' });

      const result = await tenantAgreementService.getStatus(1);

      expect(result).toEqual({ needsAcceptance: false, outdated: [] });
    });

    test('flags a PENDING instance at the current version', async () => {
      stubSingleTemplateGeneration({ documentType: 'TERMS', version: 'v1' });
      issuerModel.findByTenantId.mockResolvedValue(null);
      tenantAgreementModel.create.mockResolvedValue(null);
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue({ template_version: 'v1', status: 'PENDING' });

      const result = await tenantAgreementService.getStatus(1);

      expect(result.needsAcceptance).toBe(true);
      expect(result.outdated).toEqual([expect.objectContaining({
        documentType: 'TERMS', status: 'PENDING', acceptedVersion: null,
      })]);
    });

    test('flags an outdated ACCEPTED instance and reports the previously accepted version', async () => {
      stubSingleTemplateGeneration({ documentType: 'TERMS', version: 'v2' });
      issuerModel.findByTenantId.mockResolvedValue(null);
      tenantAgreementModel.create.mockResolvedValue({ id: 3 });
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue({ template_version: 'v1', status: 'ACCEPTED' });

      const result = await tenantAgreementService.getStatus(1);

      expect(result.needsAcceptance).toBe(true);
      expect(result.outdated).toEqual([expect.objectContaining({
        documentType: 'TERMS', currentVersion: 'v2', status: 'ACCEPTED', acceptedVersion: 'v1',
      })]);
    });
  });

  describe('hasAllAccepted', () => {
    test('returns true when nothing is outdated', async () => {
      agreementService.listCurrent.mockResolvedValue([]);

      const result = await tenantAgreementService.hasAllAccepted(1);

      expect(result).toBe(true);
    });

    test('returns false when at least one type is outdated', async () => {
      stubSingleTemplateGeneration({ documentType: 'TERMS', version: 'v1' });
      issuerModel.findByTenantId.mockResolvedValue(null);
      tenantAgreementModel.create.mockResolvedValue({ id: 1 });
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue(null);

      const result = await tenantAgreementService.hasAllAccepted(1);

      expect(result).toBe(false);
    });
  });

  describe('listForTenant', () => {
    test('delegates to the model', async () => {
      tenantAgreementModel.findAllByTenant.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const result = await tenantAgreementService.listForTenant(9);

      expect(tenantAgreementModel.findAllByTenant).toHaveBeenCalledWith(9);
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('renderForTenant', () => {
    test('throws AGREEMENT_NOT_FOUND when the tenant has no instance for the type', async () => {
      agreementService.listCurrent.mockResolvedValue([]);
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue(null);

      await expect(tenantAgreementService.renderForTenant(1, 'TERMS'))
        .rejects.toMatchObject({ statusCode: 404, code: 'AGREEMENT_NOT_FOUND' });
    });

    test('renders the personalized stored snapshot with the disclaimer prepended, wrapped in the full page', async () => {
      agreementService.listCurrent.mockResolvedValue([]);
      const acceptedAt = new Date('2026-02-01');
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue({
        document_type: 'TERMS',
        content_markdown: 'stored personalized markdown',
        template_version: 'v1',
        status: 'ACCEPTED',
        accepted_at: acceptedAt,
      });
      agreementService.buildDisclaimer.mockReturnValue('<disclaimer/>');
      agreementService.renderHtml.mockReturnValue('<p>rendered</p>');
      agreementService.wrapDocumentHtml.mockReturnValue('<html>full page</html>');

      const result = await tenantAgreementService.renderForTenant(1, 'TERMS');

      expect(agreementService.buildDisclaimer).toHaveBeenCalledWith('v1');
      expect(agreementService.renderHtml).toHaveBeenCalledWith('stored personalized markdown', {});
      expect(agreementService.wrapDocumentHtml).toHaveBeenCalledWith('TERMS', '<disclaimer/><p>rendered</p>');
      expect(result).toEqual({
        html: '<html>full page</html>',
        status: 'ACCEPTED',
        templateVersion: 'v1',
        acceptedAt,
      });
    });

    test('lazily generates a PENDING row before looking up (calls generateForTenant internally)', async () => {
      stubSingleTemplateGeneration({ documentType: 'TERMS', version: 'v1' });
      issuerModel.findByTenantId.mockResolvedValue(null);
      tenantAgreementModel.create.mockResolvedValue({ id: 1 });
      tenantAgreementModel.findLatestByTenantAndType.mockResolvedValue({
        document_type: 'TERMS', content_markdown: 'md', template_version: 'v1', status: 'PENDING', accepted_at: null,
      });
      agreementService.buildDisclaimer.mockReturnValue('');
      agreementService.renderHtml.mockReturnValue('');

      await tenantAgreementService.renderForTenant(1, 'TERMS');

      expect(tenantAgreementModel.create).toHaveBeenCalled();
    });
  });
});
