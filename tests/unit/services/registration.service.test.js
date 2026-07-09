jest.mock('../../../src/config/database');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/api-key.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/tenant-quota.service');
jest.mock('../../../src/services/crypto.service');
jest.mock('../../../src/services/certificate.service');
jest.mock('../../../src/services/email.service');
jest.mock('../../../src/services/tenant-agreement.service');

const db = require('../../../src/config/database');
const tenantModel = require('../../../src/models/tenant.model');
const issuerModel = require('../../../src/models/issuer.model');
const apiKeyModel = require('../../../src/models/api-key.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const sequentialService = require('../../../src/services/sequential.service');
const tenantQuotaService = require('../../../src/services/tenant-quota.service');
const cryptoService = require('../../../src/services/crypto.service');
const certificateService = require('../../../src/services/certificate.service');
const emailService = require('../../../src/services/email.service');
const tenantAgreementService = require('../../../src/services/tenant-agreement.service');
const config = require('../../../src/config');
const registrationService = require('../../../src/services/registration.service');

const p12Buffer = Buffer.from('fake-p12');
const p12Password = 'p12-password';

const baseFields = {
  email: 'new-tenant@example.com',
  ruc: '1790012345001',
  businessName: 'Acme Corp',
  tradeName: 'Acme',
  branchCode: '001',
  issuePointCode: '001',
  emissionType: 'NORMAL',
  requiredAccounting: false,
  termsVersion: 1,
};

describe('RegistrationService', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.getClient.mockResolvedValue(mockClient);
    tenantQuotaService.initializeForTenant.mockResolvedValue({ document_quota: 5, document_count: 0 });
    tenantQuotaService.getCurrentForTenant.mockResolvedValue({ document_quota: 5, document_count: 0 });
    tenantAgreementService.validateTermsVersion.mockResolvedValue(undefined);
    tenantAgreementService.generateForTenant.mockResolvedValue(undefined);
    certificateService.parseCertificate.mockReturnValue({
      privateKeyPem: 'PRIVATE_KEY_PEM',
      certPem: 'CERT_PEM',
      certFingerprint: 'AA:BB:CC',
      certExpiry: new Date('2030-01-01T00:00:00Z'),
    });
    cryptoService.encrypt.mockReturnValue('ENCRYPTED_PRIVATE_KEY');
    issuerDocumentTypeModel.bulkCreate.mockResolvedValue(undefined);
    sequentialService.initialize.mockResolvedValue(undefined);
    apiKeyModel.create.mockResolvedValue({ id: 999 });
    emailService.sendVerificationEmail.mockResolvedValue({ messageId: 'mg-id-1' });
    tenantModel.updateVerificationEmailSent.mockResolvedValue(undefined);
    tenantEventModel.create.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    test('rejects when the RUC is already registered by another tenant', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue({ id: 1, ruc: baseFields.ruc });

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409 });

      expect(tenantModel.create).not.toHaveBeenCalled();
    });

    test('rejects when the account already exists and is suspended', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: 1, status: 'SUSPENDED' });

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_SUSPENDED' });

      expect(issuerModel.findByTenantId).not.toHaveBeenCalled();
    });

    test('rejects when the email exists but has no issuer (inconsistent state, not a recoverable duplicate)', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: 1, status: 'ACTIVE' });
      issuerModel.findByTenantId.mockResolvedValue(null);

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409 });

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
    });

    test('idempotent re-registration: existing email + existing issuer revokes the current sandbox key and mints a new one', async () => {
      const existingTenant = {
        id: 1,
        email: baseFields.email,
        status: 'PENDING_VERIFICATION',
        subscription_tier: 'FREE',
      };
      const existingIssuer = {
        id: 10,
        ruc: baseFields.ruc,
        business_name: 'Acme Corp',
        trade_name: 'Acme',
        branch_code: '001',
        issue_point_code: '001',
        cert_fingerprint: 'AA:BB:CC',
        cert_expiry: new Date('2030-01-01T00:00:00Z'),
      };
      tenantModel.findByEmail.mockResolvedValue(existingTenant);
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);
      apiKeyModel.create.mockResolvedValue({ id: 500 });

      const result = await registrationService.register(baseFields, p12Buffer, p12Password);

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).toHaveBeenCalledWith(1, 'sandbox');
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 1,
        label: 'Recovery sandbox key',
        environment: 'sandbox',
      }));
      expect(result.recovered).toBe(true);
      expect(result.apiKey).toEqual(expect.any(String));
      expect(result.apiKey).toHaveLength(64); // 32 random bytes as hex
      expect(result.tenant).toMatchObject({ id: 1, email: baseFields.email });
      expect(result.issuer).toMatchObject({ id: 10, ruc: baseFields.ruc });

      // Does not attempt to create a brand-new tenant/issuer on the recovery path.
      expect(tenantModel.create).not.toHaveBeenCalled();
      expect(issuerModel.create).not.toHaveBeenCalled();
      expect(certificateService.parseCertificate).not.toHaveBeenCalled();
    });

    test('validates termsVersion against the published TERMS agreement before parsing the certificate', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantAgreementService.validateTermsVersion.mockRejectedValue(
        Object.assign(new Error('Terms version is outdated'), { statusCode: 409, code: 'TERMS_VERSION_OUTDATED' })
      );

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409, code: 'TERMS_VERSION_OUTDATED' });

      expect(certificateService.parseCertificate).not.toHaveBeenCalled();
      expect(tenantModel.create).not.toHaveBeenCalled();
    });

    test('propagates a certificate parsing error without creating a tenant', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      certificateService.parseCertificate.mockImplementation(() => {
        throw Object.assign(new Error('Invalid P12 certificate password.'), { statusCode: 400, code: 'CERTIFICATE_PASSWORD_INVALID' });
      });

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 400, code: 'CERTIFICATE_PASSWORD_INVALID' });

      expect(tenantModel.create).not.toHaveBeenCalled();
    });

    test('translates a duplicate-key DB error (23505) on issuer creation into a ConflictError', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      issuerModel.create.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('rethrows a non-duplicate-key DB error from issuer creation as-is', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      const dbError = Object.assign(new Error('connection lost'), { code: '08006' });
      issuerModel.create.mockRejectedValue(dbError);

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toBe(dbError);
    });

    test('happy path: creates tenant, issuer, default document type, sequential, sandbox key, and fires verification email', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      const createdTenant = {
        id: 2,
        email: baseFields.email,
        subscription_tier: 'FREE',
        status: 'PENDING_VERIFICATION',
        created_at: new Date('2026-01-01T00:00:00Z'),
      };
      const createdIssuer = {
        id: 20,
        ruc: baseFields.ruc,
        business_name: baseFields.businessName,
        trade_name: baseFields.tradeName,
        branch_code: baseFields.branchCode,
        issue_point_code: baseFields.issuePointCode,
        cert_fingerprint: 'AA:BB:CC',
        cert_expiry: new Date('2030-01-01T00:00:00Z'),
      };
      tenantModel.create.mockResolvedValue(createdTenant);
      issuerModel.create.mockResolvedValue(createdIssuer);

      const result = await registrationService.register(baseFields, p12Buffer, p12Password);

      expect(tenantAgreementService.validateTermsVersion).toHaveBeenCalledWith(baseFields.termsVersion);
      expect(cryptoService.encrypt).toHaveBeenCalledWith('PRIVATE_KEY_PEM');
      expect(tenantModel.create).toHaveBeenCalledWith(expect.objectContaining({
        email: baseFields.email,
        subscriptionTier: 'FREE',
        status: 'PENDING_VERIFICATION',
        agreementVersion: baseFields.termsVersion,
      }), mockClient);
      expect(tenantQuotaService.initializeForTenant).toHaveBeenCalledWith(2, 5, mockClient);
      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 2,
        ruc: baseFields.ruc,
        businessName: baseFields.businessName,
        encryptedPrivateKey: 'ENCRYPTED_PRIVATE_KEY',
        certificatePem: 'CERT_PEM',
        requiredAccounting: 'NO',
      }));
      expect(tenantAgreementService.generateForTenant).toHaveBeenCalledWith(2, createdIssuer);
      expect(issuerDocumentTypeModel.bulkCreate).toHaveBeenCalledWith(20, ['01']);
      expect(sequentialService.initialize).toHaveBeenCalledWith(20, baseFields.branchCode, baseFields.issuePointCode, '01', 1, true);
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 2,
        label: 'Initial sandbox key',
        environment: 'sandbox',
      }));
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        baseFields.email,
        expect.any(String),
        null,
        'es'
      );

      expect(result.recovered).toBeUndefined();
      expect(result.apiKey).toHaveLength(64);
      expect(result.tenant).toMatchObject({ id: 2, email: baseFields.email });
      expect(result.issuer).toMatchObject({ id: 20, ruc: baseFields.ruc });
    });

    test('normalises requiredAccounting truthy variants to SI', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: 20, branch_code: '001', issue_point_code: '001' });

      await registrationService.register({ ...baseFields, requiredAccounting: 'true' }, p12Buffer, p12Password);

      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({ requiredAccounting: 'SI' }));
    });

    test('uses caller-supplied documentTypes and initialSequentials instead of the defaults', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: 20, branch_code: '001', issue_point_code: '001' });

      await registrationService.register({
        ...baseFields,
        documentTypes: ['01', '04', '01'], // duplicate should be de-duped
        initialSequentials: [{ documentType: '04', sequential: '15' }],
      }, p12Buffer, p12Password);

      expect(issuerDocumentTypeModel.bulkCreate).toHaveBeenCalledWith(20, ['01', '04']);
      expect(sequentialService.initialize).toHaveBeenCalledWith(20, '001', '001', '01', 1, true);
      expect(sequentialService.initialize).toHaveBeenCalledWith(20, '001', '001', '04', 15, true);
    });

    test('does not attempt to send a verification email when EMAIL_PROVIDER is none', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: 20, branch_code: '001', issue_point_code: '001' });

      const originalProvider = config.email.provider;
      config.email.provider = 'none';
      try {
        await registrationService.register(baseFields, p12Buffer, p12Password);
      } finally {
        config.email.provider = originalProvider;
      }

      expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    test('registration does not fail even if the verification email send later rejects', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: 20, branch_code: '001', issue_point_code: '001' });
      emailService.sendVerificationEmail.mockRejectedValue(new Error('Mailgun down'));

      await expect(registrationService.register(baseFields, p12Buffer, p12Password)).resolves.toBeDefined();

      // allow the fire-and-forget rejection chain to settle so it doesn't leak into another test
      await new Promise((resolve) => setImmediate(resolve));
      expect(tenantEventModel.create).toHaveBeenCalledWith(2, 'VERIFICATION_EMAIL_FAILED', { error: 'Mailgun down' });
    });

    test('registration does not block on generateForTenant failing (fire-and-forget)', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: 2, email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: 20, branch_code: '001', issue_point_code: '001' });
      tenantAgreementService.generateForTenant.mockRejectedValue(new Error('template missing'));

      await expect(registrationService.register(baseFields, p12Buffer, p12Password)).resolves.toBeDefined();
    });
  });

  describe('resendVerification', () => {
    test('silently returns when no tenant matches the email (does not leak existence)', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);

      await expect(registrationService.resendVerification('nobody@example.com')).resolves.toBeUndefined();

      expect(tenantModel.updateVerificationToken).not.toHaveBeenCalled();
    });

    test('rejects when the tenant is already ACTIVE (verified)', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: 1, status: 'ACTIVE' });

      await expect(registrationService.resendVerification(baseFields.email))
        .rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_VERIFIED' });
    });

    test('rejects when the tenant is SUSPENDED', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: 1, status: 'SUSPENDED' });

      await expect(registrationService.resendVerification(baseFields.email))
        .rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_SUSPENDED' });
    });

    test('rejects with a 429 cooldown error when the last verification email was sent under 60 seconds ago', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: 1,
        status: 'PENDING_VERIFICATION',
        verification_email_sent_at: new Date(Date.now() - 10_000).toISOString(),
      });

      await expect(registrationService.resendVerification(baseFields.email))
        .rejects.toMatchObject({ statusCode: 429, code: 'RESEND_COOLDOWN' });

      expect(tenantModel.updateVerificationToken).not.toHaveBeenCalled();
    });

    test('allows resend once the 60-second cooldown has elapsed', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: 1,
        status: 'PENDING_VERIFICATION',
        preferred_language: 'es',
        verification_email_sent_at: new Date(Date.now() - 61_000).toISOString(),
      });

      await registrationService.resendVerification(baseFields.email);

      expect(tenantModel.updateVerificationToken).toHaveBeenCalledWith(1, expect.any(String), expect.any(Date));
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(baseFields.email, expect.any(String), null, 'es');
    });

    test('sends the first verification email when none has been sent before (no cooldown to check)', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: 1,
        status: 'PENDING_VERIFICATION',
        preferred_language: 'es',
        verification_email_sent_at: null,
      });

      await registrationService.resendVerification(baseFields.email);

      expect(tenantModel.updateVerificationToken).toHaveBeenCalledWith(1, expect.any(String), expect.any(Date));
    });

    test('updates the stored redirect URL when a new one is explicitly supplied', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: 1,
        status: 'PENDING_VERIFICATION',
        verification_email_sent_at: null,
        verification_redirect_url: 'https://old.example.com/verify',
      });

      await registrationService.resendVerification(baseFields.email, 'https://new.example.com/verify');

      expect(tenantModel.updateVerificationRedirectUrl).toHaveBeenCalledWith(1, 'https://new.example.com/verify');
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        baseFields.email, expect.any(String), 'https://new.example.com/verify', 'es'
      );
    });

    test('falls back to the tenant-stored redirect URL when none is supplied on resend', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: 1,
        status: 'PENDING_VERIFICATION',
        verification_email_sent_at: null,
        verification_redirect_url: 'https://stored.example.com/verify',
      });

      await registrationService.resendVerification(baseFields.email);

      expect(tenantModel.updateVerificationRedirectUrl).not.toHaveBeenCalled();
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        baseFields.email, expect.any(String), 'https://stored.example.com/verify', 'es'
      );
    });
  });

  describe('verifyEmail', () => {
    test('rejects when the token is invalid or expired', async () => {
      tenantModel.findByVerificationToken.mockResolvedValue(null);

      await expect(registrationService.verifyEmail('bad-token'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_OR_EXPIRED_TOKEN' });

      expect(tenantModel.activate).not.toHaveBeenCalled();
    });

    test('activates the tenant and logs an EMAIL_VERIFIED event on a valid token', async () => {
      tenantModel.findByVerificationToken.mockResolvedValue({ id: 3, email: 'someone@example.com' });

      const result = await registrationService.verifyEmail('good-token');

      expect(tenantModel.activate).toHaveBeenCalledWith(3);
      expect(tenantEventModel.create).toHaveBeenCalledWith(3, 'EMAIL_VERIFIED');
      expect(result).toEqual({ email: 'someone@example.com' });
    });
  });

  describe('formatTenant', () => {
    test('maps a DB row to the camelCase tenant response shape', () => {
      const row = {
        id: 1,
        email: 'a@example.com',
        subscription_tier: 'FREE',
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00Z'),
        agreement_accepted_at: null,
        agreement_version: null,
      };
      const quotaRow = { document_quota: 5, document_count: 2 };

      expect(registrationService.formatTenant(row, quotaRow)).toEqual({
        id: 1,
        email: 'a@example.com',
        subscriptionTier: 'FREE',
        status: 'ACTIVE',
        documentQuota: 5,
        documentCount: 2,
        createdAt: row.created_at,
        agreementAcceptedAt: null,
        agreementVersion: null,
      });
    });

    test('defaults quota fields to null when no quota row is available', () => {
      const row = {
        id: 1,
        email: 'a@example.com',
        subscription_tier: 'FREE',
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00Z'),
        agreement_accepted_at: null,
        agreement_version: null,
      };

      expect(registrationService.formatTenant(row)).toEqual({
        id: 1,
        email: 'a@example.com',
        subscriptionTier: 'FREE',
        status: 'ACTIVE',
        documentQuota: null,
        documentCount: null,
        createdAt: row.created_at,
        agreementAcceptedAt: null,
        agreementVersion: null,
      });
    });
  });
});
