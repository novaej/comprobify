jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/crypto.service');
jest.mock('../../../src/services/certificate.service');

const issuerModel = require('../../../src/models/issuer.model');
const documentModel = require('../../../src/models/document.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const tenantModel = require('../../../src/models/tenant.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const sequentialService = require('../../../src/services/sequential.service');
const cryptoService = require('../../../src/services/crypto.service');
const certificateService = require('../../../src/services/certificate.service');
const issuerService = require('../../../src/services/issuer.service');

describe('IssuerService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('removeIssuer', () => {
    const issuer = { id: '00000000-0000-0000-0000-000000000001', tenant_id: '00000000-0000-0000-0000-000000000009', branch_code: '001', issue_point_code: '001' };

    test('deactivates the issuer when more than one active issuer exists and it has no documents', async () => {
      issuerModel.countActiveByTenantId.mockResolvedValue(2);
      documentModel.existsByIssuerId.mockResolvedValue(false);

      await issuerService.removeIssuer(issuer);

      expect(issuerModel.deactivate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009');
    });

    test('rejects when the issuer is the tenant\'s last remaining one', async () => {
      issuerModel.countActiveByTenantId.mockResolvedValue(1);

      await expect(issuerService.removeIssuer(issuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'LAST_ISSUER_CANNOT_BE_REMOVED' });
      expect(documentModel.existsByIssuerId).not.toHaveBeenCalled();
      expect(issuerModel.deactivate).not.toHaveBeenCalled();
    });

    test('rejects when the issuer has issued documents', async () => {
      issuerModel.countActiveByTenantId.mockResolvedValue(2);
      documentModel.existsByIssuerId.mockResolvedValue(true);

      await expect(issuerService.removeIssuer(issuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'ISSUER_HAS_DOCUMENTS' });
      expect(issuerModel.deactivate).not.toHaveBeenCalled();
    });
  });

  describe('getSequentials', () => {
    test('fetches active document types and delegates to sequentialService.getCounters', async () => {
      const issuer = { id: '00000000-0000-0000-0000-000000000001' };
      issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01', '04']);
      sequentialService.getCounters.mockResolvedValue([{ documentType: '01' }]);

      const result = await issuerService.getSequentials(issuer);

      expect(issuerDocumentTypeModel.findActiveByIssuerId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
      expect(sequentialService.getCounters).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', ['01', '04']);
      expect(result).toEqual([{ documentType: '01' }]);
    });
  });

  describe('setSequential', () => {
    const issuer = { id: '00000000-0000-0000-0000-000000000001', branch_code: '001', issue_point_code: '001' };

    test('translates environment to the sandbox boolean and delegates to sequentialService.setNext', async () => {
      await issuerService.setSequential(issuer, '01', 'sandbox', 10);

      expect(sequentialService.setNext).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '001', '001', '01', 10, true);
    });

    test('passes sandbox=false for production', async () => {
      await issuerService.setSequential(issuer, '01', 'production', 10);

      expect(sequentialService.setNext).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '001', '001', '01', 10, false);
    });
  });

  describe('activateIssuer', () => {
    const issuer = { id: '00000000-0000-0000-0000-000000000001', tenant_id: '00000000-0000-0000-0000-000000000009', branch_code: '001' };
    const tenant = { id: '00000000-0000-0000-0000-000000000009', subscriptionTier: 'STARTER' };

    test('reactivates the issuer when the branch is brand new and under the branch limit', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(1); // STARTER maxBranches = 3
      issuerModel.activate.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });

      await issuerService.activateIssuer(issuer, tenant);

      expect(issuerModel.activate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009');
    });

    test('rejects when reactivating would exceed the branch limit', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(3); // at STARTER's maxBranches

      await expect(issuerService.activateIssuer(issuer, tenant))
        .rejects.toMatchObject({ statusCode: 402, code: 'BRANCH_LIMIT_REACHED' });
      expect(issuerModel.activate).not.toHaveBeenCalled();
    });

    test('rejects when reactivating would exceed the issue-point-per-branch limit', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(2); // at STARTER's maxIssuePointsPerBranch

      await expect(issuerService.activateIssuer(issuer, tenant))
        .rejects.toMatchObject({ statusCode: 402, code: 'ISSUE_POINT_LIMIT_REACHED' });
      expect(issuerModel.activate).not.toHaveBeenCalled();
    });

    test('skips both limit checks for an unlimited (BUSINESS) tier', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(5);
      issuerModel.activate.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });

      await issuerService.activateIssuer(issuer, { id: '00000000-0000-0000-0000-000000000009', subscriptionTier: 'BUSINESS' });

      expect(tenantModel.countBranchesByTenantId).not.toHaveBeenCalled();
      expect(issuerModel.activate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009');
    });

    test('throws NotFoundError when the issuer was not actually inactive', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(1);
      issuerModel.activate.mockResolvedValue(null);

      await expect(issuerService.activateIssuer(issuer, tenant))
        .rejects.toMatchObject({ statusCode: 404, code: 'ISSUER_NOT_FOUND' });
    });
  });

  describe('renewCertificate', () => {
    const issuer = { id: '00000000-0000-0000-0000-000000000001', tenant_id: '00000000-0000-0000-0000-000000000009' };
    const p12Buffer = Buffer.from('fake-p12');

    test('parses the new certificate, updates the issuer, and logs a CERTIFICATE_RENEWED tenant event', async () => {
      const certExpiry = new Date('2031-01-01');
      certificateService.parseCertificate.mockReturnValue({
        privateKeyPem: 'new-pk', certPem: 'new-cert', certFingerprint: 'new-fp', certExpiry,
      });
      cryptoService.encrypt.mockReturnValue('new-encrypted-pk');
      issuerModel.updateCertificate.mockResolvedValue({ cert_fingerprint: 'new-fp', cert_expiry: certExpiry });

      const result = await issuerService.renewCertificate(issuer, p12Buffer, 'pw');

      expect(issuerModel.updateCertificate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009', {
        encryptedPrivateKey: 'new-encrypted-pk', certificatePem: 'new-cert', certFingerprint: 'new-fp', certExpiry,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000009', 'CERTIFICATE_RENEWED', {
        issuerId: '00000000-0000-0000-0000-000000000001', certFingerprint: 'new-fp', certExpiry,
      });
      expect(result).toEqual({ certFingerprint: 'new-fp', certExpiry });
    });

    test('rejects and does not log an event when the issuer no longer exists', async () => {
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.updateCertificate.mockResolvedValue(null);

      await expect(issuerService.renewCertificate(issuer, p12Buffer, 'pw'))
        .rejects.toMatchObject({ statusCode: 404, code: 'ISSUER_NOT_FOUND' });
      expect(tenantEventModel.create).not.toHaveBeenCalled();
    });
  });

  describe('createBranch', () => {
    const tenant = { id: '00000000-0000-0000-0000-000000000009', subscriptionTier: 'BUSINESS', sandbox: true };
    const sourceIssuer = {
      ruc: '1234567890001', business_name: 'Acme', trade_name: null, main_address: null,
      emission_type: '1', required_accounting: 'NO', special_taxpayer: null,
      encrypted_private_key: 'src-enc', certificate_pem: 'src-cert', cert_fingerprint: 'src-fp', cert_expiry: new Date('2029-01-01'),
    };
    const fields = { branchCode: '002', issuePointCode: '001' };

    beforeEach(() => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
    });

    test('logs a CERTIFICATE_UPLOADED tenant event when a new P12 is uploaded for the branch', async () => {
      const certExpiry = new Date('2030-06-01');
      certificateService.parseCertificate.mockReturnValue({
        privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'new-fp', certExpiry,
      });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', branch_code: '002', issue_point_code: '001',
        cert_fingerprint: 'new-fp', cert_expiry: certExpiry,
      });

      await issuerService.createBranch(tenant, sourceIssuer, fields, Buffer.from('fake-p12'), 'pw');

      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000009', 'CERTIFICATE_UPLOADED', {
        issuerId: '00000000-0000-0000-0000-000000000010', certFingerprint: 'new-fp', certExpiry,
      });
    });

    test('does not log a certificate event when the branch copies the certificate from the source issuer', async () => {
      issuerModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', branch_code: '002', issue_point_code: '001' });

      await issuerService.createBranch(tenant, sourceIssuer, fields, null, null);

      expect(certificateService.parseCertificate).not.toHaveBeenCalled();
      expect(tenantEventModel.create).not.toHaveBeenCalled();
    });
  });
});
