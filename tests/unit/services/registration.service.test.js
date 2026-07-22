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
jest.mock('../../../src/services/tenant-agreement.service');
jest.mock('../../../src/services/pending-effect.service');

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
const tenantAgreementService = require('../../../src/services/tenant-agreement.service');
const pendingEffectService = require('../../../src/services/pending-effect.service');
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
    pendingEffectService.enqueue.mockResolvedValue({ id: 'effect-x', effect_type: 'X' });
    pendingEffectService.dispatch.mockResolvedValue(undefined);
    certificateService.parseCertificate.mockReturnValue({
      privateKeyPem: 'PRIVATE_KEY_PEM',
      certPem: 'CERT_PEM',
      certFingerprint: 'AA:BB:CC',
      certExpiry: new Date('2030-01-01T00:00:00Z'),
    });
    cryptoService.encrypt.mockReturnValue('ENCRYPTED_PRIVATE_KEY');
    issuerDocumentTypeModel.bulkCreate.mockResolvedValue(undefined);
    sequentialService.initialize.mockResolvedValue(undefined);
    apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000999' });
    tenantModel.updateVerificationEmailSent.mockResolvedValue(undefined);
    tenantModel.updateVerificationToken.mockResolvedValue(undefined);
    tenantModel.demoteToPendingVerification.mockImplementation((id) =>
      Promise.resolve({ id, email: baseFields.email, status: 'PENDING_VERIFICATION' })
    );
    tenantEventModel.create.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    test('rejects when the RUC is already registered by another tenant', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', ruc: baseFields.ruc });

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409 });

      expect(tenantModel.create).not.toHaveBeenCalled();
    });

    test('rejects when an account with the given email already exists, regardless of status or issuer state', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' });

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409 });

      // register() no longer inspects the existing tenant/issuer at all —
      // that's recover()'s job now. No cert parsing, no key operations.
      expect(issuerModel.findByTenantId).not.toHaveBeenCalled();
      expect(certificateService.parseCertificate).not.toHaveBeenCalled();
      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
      expect(tenantModel.create).not.toHaveBeenCalled();
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
      tenantModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      issuerModel.create.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('rethrows a non-duplicate-key DB error from issuer creation as-is', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      const dbError = Object.assign(new Error('connection lost'), { code: '08006' });
      issuerModel.create.mockRejectedValue(dbError);

      await expect(registrationService.register(baseFields, p12Buffer, p12Password))
        .rejects.toBe(dbError);
    });

    test('happy path: creates tenant, issuer, default document type, sequential, sandbox key, and fires verification email', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      const createdTenant = {
        id: '00000000-0000-0000-0000-000000000002',
        email: baseFields.email,
        subscription_tier: 'FREE',
        status: 'PENDING_VERIFICATION',
        created_at: new Date('2026-01-01T00:00:00Z'),
      };
      const createdIssuer = {
        id: '00000000-0000-0000-0000-000000000020',
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
        legalVersion: baseFields.termsVersion,
      }), mockClient);
      expect(tenantQuotaService.initializeForTenant).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000002', 5, mockClient);
      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000002',
        ruc: baseFields.ruc,
        businessName: baseFields.businessName,
        encryptedPrivateKey: 'ENCRYPTED_PRIVATE_KEY',
        certificatePem: 'CERT_PEM',
        requiredAccounting: 'NO',
      }));
      // Legal-document generation and the verification email are both
      // durably enqueued as pending_effects rows (ADR-022) rather than
      // called directly — the handlers (src/effects/index.js) do the
      // actual work later.
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'TENANT_AGREEMENT_GENERATE', '00000000-0000-0000-0000-000000000002', { tenantId: '00000000-0000-0000-0000-000000000002' }
      );
      expect(issuerDocumentTypeModel.bulkCreate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', ['01']);
      expect(sequentialService.initialize).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', baseFields.branchCode, baseFields.issuePointCode, '01', 1, true);
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000002',
        label: 'Initial sandbox key',
        environment: 'sandbox',
      }));
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'VERIFICATION_EMAIL_SEND',
        '00000000-0000-0000-0000-000000000002',
        expect.objectContaining({
          tenantId: '00000000-0000-0000-0000-000000000002',
          email: baseFields.email,
          verificationToken: expect.any(String),
          redirectUrl: null,
          language: 'es',
        })
      );

      expect(result.recovered).toBeUndefined();
      expect(result.apiKey).toHaveLength(64);
      expect(result.tenant).toMatchObject({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      expect(result.issuer).toMatchObject({ id: '00000000-0000-0000-0000-000000000020', ruc: baseFields.ruc });
    });

    test('normalises requiredAccounting truthy variants to SI', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', branch_code: '001', issue_point_code: '001' });

      await registrationService.register({ ...baseFields, requiredAccounting: 'true' }, p12Buffer, p12Password);

      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({ requiredAccounting: 'SI' }));
    });

    test('uses caller-supplied documentTypes and initialSequentials instead of the defaults', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', branch_code: '001', issue_point_code: '001' });

      await registrationService.register({
        ...baseFields,
        documentTypes: ['01', '04', '01'], // duplicate should be de-duped
        initialSequentials: [{ documentType: '04', sequential: '15' }],
      }, p12Buffer, p12Password);

      expect(issuerDocumentTypeModel.bulkCreate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', ['01', '04']);
      expect(sequentialService.initialize).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', '001', '001', '01', 1, true);
      expect(sequentialService.initialize).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', '001', '001', '04', 15, true);
    });

    test('does not attempt to send a verification email when EMAIL_PROVIDER is none', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', branch_code: '001', issue_point_code: '001' });

      const originalProvider = config.email.provider;
      config.email.provider = 'none';
      try {
        await registrationService.register(baseFields, p12Buffer, p12Password);
      } finally {
        config.email.provider = originalProvider;
      }

      expect(pendingEffectService.enqueue).not.toHaveBeenCalledWith('VERIFICATION_EMAIL_SEND', expect.anything());
    });

    test('registration does not wait on effect dispatch (the RabbitMQ publish) before returning', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      issuerModel.findByRuc.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002', email: baseFields.email });
      issuerModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', branch_code: '001', issue_point_code: '001' });
      // Never resolves — if register() awaited dispatch() anywhere, this
      // test would hang/time out instead of resolving. enqueue() (the
      // durable insert) is what must be awaited, not dispatch (best-effort).
      pendingEffectService.dispatch.mockReturnValue(new Promise(() => {}));

      await expect(registrationService.register(baseFields, p12Buffer, p12Password)).resolves.toBeDefined();
    });
  });

  describe('recover', () => {
    const existingTenant = {
      id: '00000000-0000-0000-0000-000000000001',
      email: baseFields.email,
      status: 'ACTIVE',
      subscription_tier: 'FREE',
      sandbox: true,
      preferred_language: 'es',
      verification_redirect_url: null,
    };
    const existingIssuer = {
      id: '00000000-0000-0000-0000-000000000010',
      ruc: baseFields.ruc,
      business_name: 'Acme Corp',
      trade_name: 'Acme',
      branch_code: '001',
      issue_point_code: '001',
      cert_fingerprint: 'AA:BB:CC', // matches the default parseCertificate mock from beforeEach
      cert_expiry: new Date('2030-01-01T00:00:00Z'),
    };

    test('parses the certificate before looking up the tenant (anti-enumeration ordering)', async () => {
      certificateService.parseCertificate.mockImplementation(() => {
        throw Object.assign(new Error('Invalid P12 certificate password.'), { statusCode: 400, code: 'CERTIFICATE_PASSWORD_INVALID' });
      });

      await expect(registrationService.recover(baseFields.email, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 400, code: 'CERTIFICATE_PASSWORD_INVALID' });

      expect(tenantModel.findByEmail).not.toHaveBeenCalled();
    });

    test('returns a generic response when no tenant matches the email (does not leak existence)', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);

      const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      expect(result).toEqual({ ok: true, message: expect.any(String) });
      expect(result.apiKey).toBeUndefined();
      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
      expect(apiKeyModel.create).not.toHaveBeenCalled();
      expect(pendingEffectService.enqueue).not.toHaveBeenCalledWith('VERIFICATION_EMAIL_SEND', expect.anything());
    });

    test('returns the same generic response when the tenant has no issuer (inconsistent state)', async () => {
      tenantModel.findByEmail.mockResolvedValue(existingTenant);
      issuerModel.findByTenantId.mockResolvedValue(null);

      const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      expect(result).toEqual({ ok: true, message: expect.any(String) });
      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
    });

    test('returns the same generic response when the certificate fingerprint does not match (indistinguishable from a nonexistent email)', async () => {
      tenantModel.findByEmail.mockResolvedValue(existingTenant);
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);
      certificateService.parseCertificate.mockReturnValue({
        privateKeyPem: 'PRIVATE_KEY_PEM',
        certPem: 'CERT_PEM',
        certFingerprint: 'AN-ATTACKERS-DIFFERENT-CERT',
        certExpiry: new Date('2030-01-01T00:00:00Z'),
      });

      const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      expect(result).toEqual({ ok: true, message: expect.any(String) });
      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
      expect(apiKeyModel.create).not.toHaveBeenCalled();
      expect(pendingEffectService.enqueue).not.toHaveBeenCalledWith('VERIFICATION_EMAIL_SEND', expect.anything());
    });

    test('rejects with ACCOUNT_SUSPENDED when the certificate matches but the tenant is suspended', async () => {
      tenantModel.findByEmail.mockResolvedValue({ ...existingTenant, status: 'SUSPENDED' });
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);

      await expect(registrationService.recover(baseFields.email, p12Buffer, p12Password))
        .rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_SUSPENDED' });

      // Suspension is only ever revealed to a caller who already proved
      // ownership via a matching certificate.
      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
    });

    test('matched + sandbox tenant: revokes and reissues a sandbox key', async () => {
      tenantModel.findByEmail.mockResolvedValue({ ...existingTenant, sandbox: true });
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000500' });

      const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'sandbox');
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        label: 'Recovery key',
        environment: 'sandbox',
      }));
      expect(result.environment).toBe('sandbox');
      expect(result.apiKey).toEqual(expect.any(String));
      expect(result.apiKey).toHaveLength(64);
      expect(result.tenant).toMatchObject({ id: '00000000-0000-0000-0000-000000000001', email: baseFields.email });
      expect(result.issuer).toMatchObject({ id: '00000000-0000-0000-0000-000000000010', ruc: baseFields.ruc });
    });

    test('matched + production (promoted) tenant: revokes and reissues a production key, not sandbox (regression test)', async () => {
      tenantModel.findByEmail.mockResolvedValue({ ...existingTenant, sandbox: false });
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000501' });

      const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'production');
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        environment: 'production',
      }));
      expect(result.environment).toBe('production');
    });

    test('matched: forces re-verification by demoting the tenant to PENDING_VERIFICATION with a fresh token', async () => {
      tenantModel.findByEmail.mockResolvedValue(existingTenant);
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);

      const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      // A matching certificate proves possession of the P12, not control of
      // the email inbox — extra validation demotes the tenant until the
      // fresh verification link is clicked (same restrictions any newly
      // registered PENDING_VERIFICATION tenant already has).
      expect(tenantModel.demoteToPendingVerification).toHaveBeenCalledWith(
        existingTenant.id,
        expect.any(String),
        expect.any(Date)
      );
      expect(tenantModel.updateVerificationToken).not.toHaveBeenCalled();
      expect(result.tenant.status).toBe('PENDING_VERIFICATION');
    });

    test('matched: durably enqueues a fresh verification email effect as an out-of-band notice', async () => {
      tenantModel.findByEmail.mockResolvedValue(existingTenant);
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);

      await registrationService.recover(baseFields.email, p12Buffer, p12Password);

      // Sending, stamping verification_email_sent_at, and logging
      // VERIFICATION_EMAIL_SENT/FAILED all happen in the effect handler
      // (src/effects/index.js) now, not here — see ADR-022.
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'VERIFICATION_EMAIL_SEND',
        existingTenant.id,
        {
          tenantId: existingTenant.id,
          email: baseFields.email,
          verificationToken: expect.any(String),
          redirectUrl: existingTenant.verification_redirect_url,
          language: existingTenant.preferred_language,
        }
      );
    });

    test('matched, EMAIL_PROVIDER=none: still demotes to PENDING_VERIFICATION even though no email can be sent', async () => {
      tenantModel.findByEmail.mockResolvedValue(existingTenant);
      issuerModel.findByTenantId.mockResolvedValue(existingIssuer);
      const originalProvider = config.email.provider;
      config.email.provider = 'none';

      try {
        const result = await registrationService.recover(baseFields.email, p12Buffer, p12Password);
        expect(tenantModel.demoteToPendingVerification).toHaveBeenCalled();
        expect(result.tenant.status).toBe('PENDING_VERIFICATION');
        expect(pendingEffectService.enqueue).not.toHaveBeenCalledWith('VERIFICATION_EMAIL_SEND', expect.anything());
      } finally {
        config.email.provider = originalProvider;
      }
    });
  });

  describe('resendVerification', () => {
    test('silently returns when no tenant matches the email (does not leak existence)', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);

      await expect(registrationService.resendVerification('nobody@example.com')).resolves.toBeUndefined();

      expect(tenantModel.updateVerificationToken).not.toHaveBeenCalled();
    });

    test('rejects when the tenant is already ACTIVE (verified)', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' });

      await expect(registrationService.resendVerification(baseFields.email))
        .rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_VERIFIED' });
    });

    test('rejects when the tenant is SUSPENDED', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'SUSPENDED' });

      await expect(registrationService.resendVerification(baseFields.email))
        .rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_SUSPENDED' });
    });

    test('rejects with a 429 cooldown error when the last verification email was sent under 60 seconds ago', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'PENDING_VERIFICATION',
        verification_email_sent_at: new Date(Date.now() - 10_000).toISOString(),
      });

      await expect(registrationService.resendVerification(baseFields.email))
        .rejects.toMatchObject({ statusCode: 429, code: 'RESEND_COOLDOWN' });

      expect(tenantModel.updateVerificationToken).not.toHaveBeenCalled();
    });

    test('allows resend once the 60-second cooldown has elapsed', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'PENDING_VERIFICATION',
        preferred_language: 'es',
        verification_email_sent_at: new Date(Date.now() - 61_000).toISOString(),
      });

      await registrationService.resendVerification(baseFields.email);

      expect(tenantModel.updateVerificationToken).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', expect.any(String), expect.any(Date));
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'VERIFICATION_EMAIL_SEND',
        '00000000-0000-0000-0000-000000000001',
        expect.objectContaining({ email: baseFields.email, redirectUrl: null, language: 'es' })
      );
    });

    test('sends the first verification email when none has been sent before (no cooldown to check)', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'PENDING_VERIFICATION',
        preferred_language: 'es',
        verification_email_sent_at: null,
      });

      await registrationService.resendVerification(baseFields.email);

      expect(tenantModel.updateVerificationToken).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', expect.any(String), expect.any(Date));
    });

    test('updates the stored redirect URL when a new one is explicitly supplied', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'PENDING_VERIFICATION',
        verification_email_sent_at: null,
        verification_redirect_url: 'https://old.example.com/verify',
      });

      await registrationService.resendVerification(baseFields.email, 'https://new.example.com/verify');

      expect(tenantModel.updateVerificationRedirectUrl).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'https://new.example.com/verify');
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'VERIFICATION_EMAIL_SEND',
        '00000000-0000-0000-0000-000000000001',
        expect.objectContaining({ email: baseFields.email, redirectUrl: 'https://new.example.com/verify', language: 'es' })
      );
    });

    test('falls back to the tenant-stored redirect URL when none is supplied on resend', async () => {
      tenantModel.findByEmail.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'PENDING_VERIFICATION',
        verification_email_sent_at: null,
        verification_redirect_url: 'https://stored.example.com/verify',
      });

      await registrationService.resendVerification(baseFields.email);

      expect(tenantModel.updateVerificationRedirectUrl).not.toHaveBeenCalled();
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'VERIFICATION_EMAIL_SEND',
        '00000000-0000-0000-0000-000000000001',
        expect.objectContaining({ email: baseFields.email, redirectUrl: 'https://stored.example.com/verify', language: 'es' })
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
      tenantModel.findByVerificationToken.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000003', email: 'someone@example.com' });

      const result = await registrationService.verifyEmail('good-token');

      expect(tenantModel.activate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'EMAIL_VERIFIED');
      expect(result).toEqual({ email: 'someone@example.com' });
    });
  });

  describe('formatTenant', () => {
    test('maps a DB row to the camelCase tenant response shape', () => {
      const row = {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@example.com',
        subscription_tier: 'FREE',
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00Z'),
        agreement_accepted_at: null,
        agreement_version: null,
      };
      const quotaRow = { document_quota: 5, document_count: 2 };

      expect(registrationService.formatTenant(row, quotaRow)).toEqual({
        id: '00000000-0000-0000-0000-000000000001',
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
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@example.com',
        subscription_tier: 'FREE',
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00Z'),
        agreement_accepted_at: null,
        agreement_version: null,
      };

      expect(registrationService.formatTenant(row)).toEqual({
        id: '00000000-0000-0000-0000-000000000001',
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
