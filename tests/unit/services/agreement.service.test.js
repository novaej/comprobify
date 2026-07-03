jest.mock('fs');
jest.mock('../../../src/models/agreement.model');

const fs = require('fs');
const crypto = require('crypto');
const agreementModel = require('../../../src/models/agreement.model');
const config = require('../../../src/config');
const agreementService = require('../../../src/services/agreement.service');

describe('AgreementService', () => {
  const originalOperator = { ...config.operator };

  afterEach(() => {
    jest.clearAllMocks();
    config.operator = { ...originalOperator };
  });

  describe('publish', () => {
    beforeEach(() => {
      config.operator = {
        nombre: 'Comprobify Cia. Ltda.',
        ruc: '1790000000001',
        email: 'legal@comprobify.com',
        domicilio: 'Quito, Ecuador',
      };
    });

    test('throws an AppError (OPERATOR_CONFIG_MISSING, 500) when any OPERATOR_* env var is missing', async () => {
      config.operator = { nombre: '', ruc: '1790000000001', email: 'legal@comprobify.com' };

      await expect(agreementService.publish('TERMS', '1.0')).rejects.toMatchObject({
        statusCode: 500,
        code: 'OPERATOR_CONFIG_MISSING',
        message: 'OPERATOR_NAME, OPERATOR_RUC, and OPERATOR_EMAIL must all be set before publishing legal documents',
      });
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(agreementModel.create).not.toHaveBeenCalled();
    });

    test('reads the source file, strips the draft header, substitutes operator tokens, hashes, creates, and activates', async () => {
      const raw = '> BORRADOR PARA REVISIÓN\n> no publicar\n\n# Términos de Servicio\n\nOperado por {{operador.nombre}} ({{operador.ruc}}).';
      fs.readFileSync.mockReturnValue(raw);
      agreementModel.create.mockResolvedValue({ id: 5, document_type: 'TERMS', version: '1.0' });
      agreementModel.activate.mockResolvedValue({ id: 5, document_type: 'TERMS', version: '1.0', is_current: true });

      const result = await agreementService.publish('TERMS', '1.0');

      expect(fs.readFileSync).toHaveBeenCalledWith(agreementService.AGREEMENT_FILE_MAP.TERMS, 'utf8');

      const [createArgs] = agreementModel.create.mock.calls[0];
      expect(createArgs.documentType).toBe('TERMS');
      expect(createArgs.version).toBe('1.0');
      expect(createArgs.contentMarkdown).not.toMatch(/BORRADOR/);
      expect(createArgs.contentMarkdown).toContain('Operado por Comprobify Cia. Ltda. (1790000000001).');
      expect(createArgs.contentHash).toBe(crypto.createHash('sha256').update(createArgs.contentMarkdown).digest('hex'));

      expect(agreementModel.activate).toHaveBeenCalledWith(5);
      // publish() returns the row from create(), not the (separately awaited) activate() result.
      expect(result).toEqual({ id: 5, document_type: 'TERMS', version: '1.0' });
    });

    test('falls back to the default domicilio when OPERATOR_ADDRESS is unset', async () => {
      config.operator = { nombre: 'Comprobify', ruc: '1790000000001', email: 'legal@comprobify.com', domicilio: '' };
      fs.readFileSync.mockReturnValue('# DPA\n\nDomicilio: {{operador.domicilio}}');
      agreementModel.create.mockResolvedValue({ id: 6 });
      agreementModel.activate.mockResolvedValue({ id: 6 });

      await agreementService.publish('DPA', '1.0');

      const [createArgs] = agreementModel.create.mock.calls[0];
      expect(createArgs.contentMarkdown).toContain('Domicilio disponible previa solicitud razonable');
    });
  });

  describe('activateVersion', () => {
    test('throws NotFoundError (AGREEMENT_NOT_FOUND) when the model returns null', async () => {
      agreementModel.activate.mockResolvedValue(null);

      await expect(agreementService.activateVersion(999)).rejects.toMatchObject({
        statusCode: 404,
        code: 'AGREEMENT_NOT_FOUND',
      });
    });

    test('returns the activated row', async () => {
      agreementModel.activate.mockResolvedValue({ id: 5, is_current: true });

      const result = await agreementService.activateVersion(5);

      expect(agreementModel.activate).toHaveBeenCalledWith(5);
      expect(result).toEqual({ id: 5, is_current: true });
    });
  });

  describe('listVersionsByType', () => {
    test('delegates to agreementModel.findAllByType', async () => {
      agreementModel.findAllByType.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const result = await agreementService.listVersionsByType('TERMS');

      expect(agreementModel.findAllByType).toHaveBeenCalledWith('TERMS');
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('getCurrent', () => {
    test('throws NotFoundError (AGREEMENT_NOT_FOUND) when no current version exists', async () => {
      agreementModel.findCurrentByType.mockResolvedValue(null);

      await expect(agreementService.getCurrent('PRIVACY')).rejects.toMatchObject({
        statusCode: 404,
        code: 'AGREEMENT_NOT_FOUND',
      });
    });

    test('returns the current row', async () => {
      agreementModel.findCurrentByType.mockResolvedValue({ id: 3, document_type: 'PRIVACY' });

      const result = await agreementService.getCurrent('PRIVACY');

      expect(result).toEqual({ id: 3, document_type: 'PRIVACY' });
    });
  });

  describe('listCurrent', () => {
    test('delegates to agreementModel.findAllCurrent', async () => {
      agreementModel.findAllCurrent.mockResolvedValue([{ document_type: 'TERMS' }]);

      const result = await agreementService.listCurrent();

      expect(result).toEqual([{ document_type: 'TERMS' }]);
    });
  });

  describe('substitutePlaceholders', () => {
    test('replaces a flat token', () => {
      expect(agreementService.substitutePlaceholders('Hola {{nombre}}', { nombre: 'Mundo' })).toBe('Hola Mundo');
    });

    test('replaces a nested dotted-path token', () => {
      expect(
        agreementService.substitutePlaceholders('RUC: {{cliente.ruc}}', { cliente: { ruc: '1790000000001' } })
      ).toBe('RUC: 1790000000001');
    });

    test('leaves unmatched tokens visible instead of silently disappearing', () => {
      expect(agreementService.substitutePlaceholders('Hola {{desconocido}}', {})).toBe('Hola {{desconocido}}');
    });

    test('leaves a nested token visible when only a shallower key is missing', () => {
      expect(agreementService.substitutePlaceholders('{{cliente.razonSocial}}', {})).toBe('{{cliente.razonSocial}}');
    });

    test('tolerates surrounding whitespace inside the braces', () => {
      expect(agreementService.substitutePlaceholders('{{ nombre }}', { nombre: 'Mundo' })).toBe('Mundo');
    });

    test('replaces every occurrence of the same token', () => {
      expect(agreementService.substitutePlaceholders('{{x}} y {{x}}', { x: '1' })).toBe('1 y 1');
    });
  });

  describe('renderHtml', () => {
    test('renders markdown to HTML', () => {
      const html = agreementService.renderHtml('# Title\n\nSome **bold** text.');

      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('<strong>bold</strong>');
    });

    test('substitutes placeholders before rendering', () => {
      const html = agreementService.renderHtml('Hola {{nombre}}', { nombre: 'Mundo' });

      expect(html).toContain('Hola Mundo');
    });
  });

  describe('getCurrentHtml', () => {
    test('renders the current version with a default fecha derived from created_at', async () => {
      agreementModel.findCurrentByType.mockResolvedValue({
        id: 5, version: '1.0', content_markdown: 'Versión: {{fecha}}', created_at: '2026-07-01T00:00:00Z',
      });

      const result = await agreementService.getCurrentHtml('TERMS');

      expect(result.version).toBe('1.0');
      expect(result.html).toContain(agreementService.formatDate('2026-07-01T00:00:00Z'));
    });

    test('lets a caller-supplied fecha override the default', async () => {
      agreementModel.findCurrentByType.mockResolvedValue({
        id: 5, version: '1.0', content_markdown: 'Versión: {{fecha}}', created_at: '2026-07-01T00:00:00Z',
      });

      const result = await agreementService.getCurrentHtml('TERMS', { fecha: '15 de junio de 2026' });

      expect(result.html).toContain('15 de junio de 2026');
    });

    test('propagates NotFoundError when there is no current version', async () => {
      agreementModel.findCurrentByType.mockResolvedValue(null);

      await expect(agreementService.getCurrentHtml('TERMS')).rejects.toMatchObject({
        statusCode: 404,
        code: 'AGREEMENT_NOT_FOUND',
      });
    });
  });

  describe('stripDraftHeader', () => {
    test('removes a leading blockquote draft header up to the first blank line', () => {
      const raw = '> BORRADOR PARA REVISIÓN\n> no publicar\n\n# Título\n\nContenido.';

      expect(agreementService.stripDraftHeader(raw)).toBe('# Título\n\nContenido.');
    });

    test('is a no-op when there is no draft header', () => {
      const raw = '# Título\n\nContenido.';

      expect(agreementService.stripDraftHeader(raw)).toBe('# Título\n\nContenido.');
    });
  });

  describe('computeHash', () => {
    test('returns the sha256 hex digest of the given string', () => {
      const expected = crypto.createHash('sha256').update('hello').digest('hex');

      expect(agreementService.computeHash('hello')).toBe(expected);
    });

    test('different content produces a different hash', () => {
      expect(agreementService.computeHash('a')).not.toBe(agreementService.computeHash('b'));
    });
  });

  describe('formatDate', () => {
    test('formats a date in long-form Spanish', () => {
      const formatted = agreementService.formatDate('2026-07-02T00:00:00Z');

      expect(formatted).toMatch(/2026/);
      expect(formatted).toMatch(/julio/);
    });
  });

  describe('buildDisclaimer', () => {
    const originalAdminNotificationEmail = config.adminNotificationEmail;

    afterEach(() => {
      config.adminNotificationEmail = originalAdminNotificationEmail;
    });

    test('includes a mailto link to the support inbox (ADMIN_NOTIFICATION_EMAIL) when configured', () => {
      config.adminNotificationEmail = 'soporte@comprobify.com';

      const html = agreementService.buildDisclaimer('1.0');

      expect(html).toContain('mailto:soporte@comprobify.com');
      expect(html).toContain('Versión: 1.0');
    });

    test('does not use the operator identity email even when configured', () => {
      config.adminNotificationEmail = '';
      config.operator = { ...config.operator, email: 'legal@comprobify.com' };

      const html = agreementService.buildDisclaimer('1.0');

      expect(html).not.toContain('legal@comprobify.com');
    });

    test('falls back to generic contact wording when no support email is configured', () => {
      config.adminNotificationEmail = '';

      const html = agreementService.buildDisclaimer('1.0');

      expect(html).not.toContain('mailto:');
      expect(html).toContain('canales indicados');
    });
  });

  describe('AGREEMENT_TYPES / AGREEMENT_FILE_MAP', () => {
    test('exposes exactly TERMS, PRIVACY, DPA', () => {
      expect(agreementService.AGREEMENT_TYPES).toEqual(['TERMS', 'PRIVACY', 'DPA']);
      expect(Object.keys(agreementService.AGREEMENT_FILE_MAP).sort()).toEqual(['DPA', 'PRIVACY', 'TERMS']);
    });
  });
});
