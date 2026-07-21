jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/models/sri-response.model');
jest.mock('../../../src/models/catalog.model');

const documentModel = require('../../../src/models/document.model');
const documentEventModel = require('../../../src/models/document-event.model');
const sriResponseModel = require('../../../src/models/sri-response.model');
const catalogModel = require('../../../src/models/catalog.model');
const documentQueryService = require('../../../src/services/document-query.service');

const mockIssuer = { id: '00000000-0000-0000-0000-000000000005', sandbox: false, branch_code: '001', issue_point_code: '001' };
const accessKey = '1234567890123456789012345678901234567890123456789';

describe('DocumentQueryService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getByAccessKey', () => {
    test('returns the formatted document when found', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: accessKey, sequential: 7, status: 'SIGNED', issue_date: new Date('2026-01-15'), total: '112.00',
      });

      const result = await documentQueryService.getByAccessKey(accessKey, mockIssuer);

      expect(documentModel.findByAccessKey).toHaveBeenCalledWith(accessKey, '00000000-0000-0000-0000-000000000005', false);
      expect(result.accessKey).toBe(accessKey);
      expect(result.sequential).toBe('000000007');
      expect(result.status).toBe('SIGNED');
    });

    test('returns null when the document is not found', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      const result = await documentQueryService.getByAccessKey(accessKey, mockIssuer);

      expect(result).toBeNull();
    });
  });

  describe('getXml', () => {
    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentQueryService.getXml(accessKey, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('prefers authorization_xml over signed_xml when both are present', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        authorization_xml: '<auth/>', signed_xml: '<signed/>',
      });

      const result = await documentQueryService.getXml(accessKey, mockIssuer);

      expect(result).toEqual({ xml: '<auth/>', contentType: 'application/xml' });
    });

    test('falls back to signed_xml when authorization_xml is not set', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        authorization_xml: null, signed_xml: '<signed/>',
      });

      const result = await documentQueryService.getXml(accessKey, mockIssuer);

      expect(result).toEqual({ xml: '<signed/>', contentType: 'application/xml' });
    });
  });

  describe('getEvents', () => {
    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentQueryService.getEvents(accessKey, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(documentEventModel.findByDocumentId).not.toHaveBeenCalled();
    });

    test('returns the audit trail mapped to the camelCase response shape', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010' });
      const createdAt = new Date('2026-01-15T10:00:00Z');
      documentEventModel.findByDocumentId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', event_type: 'CREATED', from_status: null, to_status: 'SIGNED', detail: { foo: 'bar' }, created_at: createdAt },
        { id: '00000000-0000-0000-0000-000000000002', event_type: 'SENT', from_status: 'SIGNED', to_status: 'RECEIVED', detail: null, created_at: createdAt },
      ]);

      const result = await documentQueryService.getEvents(accessKey, mockIssuer);

      expect(documentEventModel.findByDocumentId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000005', false);
      expect(result).toEqual([
        { id: '00000000-0000-0000-0000-000000000001', eventType: 'CREATED', fromStatus: null, toStatus: 'SIGNED', detail: { foo: 'bar' }, createdAt },
        { id: '00000000-0000-0000-0000-000000000002', eventType: 'SENT', fromStatus: 'SIGNED', toStatus: 'RECEIVED', detail: null, createdAt },
      ]);
    });

    test('returns an empty array when the document has no events', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010' });
      documentEventModel.findByDocumentId.mockResolvedValue([]);

      const result = await documentQueryService.getEvents(accessKey, mockIssuer);

      expect(result).toEqual([]);
    });
  });

  describe('getSriResponses', () => {
    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentQueryService.getSriResponses(accessKey, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(sriResponseModel.findByDocumentId).not.toHaveBeenCalled();
    });

    test('passes the issuer sandbox flag through and maps rows to the camelCase response shape', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010' });
      const createdAt = new Date('2026-01-15T10:00:00Z');
      sriResponseModel.findByDocumentId.mockResolvedValue([
        {
          operation_type: 'AUTHORIZATION',
          status: 'NO_AUTORIZADO',
          messages: [{ identifier: '45', message: 'RUC no existe', additionalInfo: null, type: 'ERROR' }],
          raw_response: '<raw/>',
          created_at: createdAt,
        },
      ]);

      const result = await documentQueryService.getSriResponses(accessKey, mockIssuer);

      expect(sriResponseModel.findByDocumentId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', false);
      expect(result).toEqual([
        {
          operationType: 'AUTHORIZATION',
          status: 'NO_AUTORIZADO',
          messages: [{ identifier: '45', message: 'RUC no existe', additionalInfo: null, type: 'ERROR' }],
          createdAt,
        },
      ]);
    });

    test('returns an empty array when the document has no SRI responses', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010' });
      sriResponseModel.findByDocumentId.mockResolvedValue([]);

      const result = await documentQueryService.getSriResponses(accessKey, mockIssuer);

      expect(result).toEqual([]);
    });
  });

  describe('list', () => {
    test('converts from/to filters from DD/MM/YYYY to YYYY-MM-DD before calling the model', async () => {
      documentModel.findByIssuerId.mockResolvedValue({ documents: [], pagination: { page: 1, total: 0 } });

      await documentQueryService.list(mockIssuer, { from: '01/02/2026', to: '28/02/2026', status: 'AUTHORIZED' });

      expect(documentModel.findByIssuerId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000005', {
        from: '2026-02-01', to: '2026-02-28', status: 'AUTHORIZED',
      }, false);
    });

    test('leaves filters without from/to untouched', async () => {
      documentModel.findByIssuerId.mockResolvedValue({ documents: [], pagination: { page: 1, total: 0 } });

      await documentQueryService.list(mockIssuer, { status: 'SIGNED' });

      expect(documentModel.findByIssuerId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000005', { status: 'SIGNED' }, false);
    });

    test('defaults filters to {} when none are supplied', async () => {
      documentModel.findByIssuerId.mockResolvedValue({ documents: [], pagination: { page: 1, total: 0 } });

      await documentQueryService.list(mockIssuer);

      expect(documentModel.findByIssuerId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000005', {}, false);
    });

    test('formats every returned document and preserves pagination', async () => {
      documentModel.findByIssuerId.mockResolvedValue({
        documents: [
          { access_key: 'k1', sequential: 1, status: 'SIGNED', issue_date: new Date('2026-01-01'), total: '10.00' },
          { access_key: 'k2', sequential: 2, status: 'AUTHORIZED', issue_date: new Date('2026-01-02'), total: '20.00' },
        ],
        pagination: { page: 1, pageSize: 20, total: 2 },
      });

      const result = await documentQueryService.list(mockIssuer, {});

      expect(result.data).toHaveLength(2);
      expect(result.data[0].accessKey).toBe('k1');
      expect(result.data[1].accessKey).toBe('k2');
      expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 2 });
    });
  });

  describe('getStats', () => {
    test('maps document type codes to labels and formats totals', async () => {
      documentModel.getStats.mockResolvedValue({
        byType: [
          { document_type: '01', issued: '5', authorized_total: '1800' },
          { document_type: '04', issued: '2', authorized_total: '0' },
        ],
        needsAttention: 3,
      });
      catalogModel.getDocumentTypeLabel.mockImplementation((code) => Promise.resolve({ '01': 'FAC', '04': 'NC' }[code]));

      const result = await documentQueryService.getStats(mockIssuer);

      expect(documentModel.getStats).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000005', false);
      expect(result).toEqual({
        thisMonth: {
          byType: [
            { type: 'FAC', issued: 5, authorizedTotal: '1800.00' },
            { type: 'NC', issued: 2, authorizedTotal: '0.00' },
          ],
        },
        needsAttention: 3,
      });
    });

    test('returns an empty byType array when nothing was issued', async () => {
      documentModel.getStats.mockResolvedValue({ byType: [], needsAttention: 0 });

      const result = await documentQueryService.getStats(mockIssuer);

      expect(result).toEqual({ thisMonth: { byType: [] }, needsAttention: 0 });
    });
  });

  describe('getCreditNotes', () => {
    test('throws NotFoundError when the original document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentQueryService.getCreditNotes(accessKey, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('reconstructs the NNN-NNN-NNNNNNNNN number from issuer branch/issue point + padded sequential', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '01', sequential: 27, total: '115.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([]);

      await documentQueryService.getCreditNotes('orig-key', mockIssuer);

      expect(documentModel.findCreditNotesByOriginalDocument).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000005', '01', '001-001-000000027', false
      );
    });

    test('sums AUTHORIZED credit note totals and computes the remaining balance', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '01', sequential: 27, total: '115.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([
        { access_key: 'cn-1', sequential: 12, total: '30.00', issue_date: new Date('2026-04-01T12:00:00Z') },
        { access_key: 'cn-2', sequential: 13, total: '5.00', issue_date: new Date('2026-04-02T12:00:00Z') },
      ]);

      const result = await documentQueryService.getCreditNotes('orig-key', mockIssuer);

      expect(result.originalDocument).toEqual({ accessKey: 'orig-key', total: '115.00' });
      expect(result.creditedTotal).toBe('35.00');
      expect(result.remaining).toBe('80.00');
      expect(result.creditNotes).toEqual([
        { accessKey: 'cn-1', sequential: '000000012', total: '30.00', issueDate: '01/04/2026' },
        { accessKey: 'cn-2', sequential: '000000013', total: '5.00', issueDate: '02/04/2026' },
      ]);
    });

    test('reports full remaining balance when no credit notes have been issued', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '01', sequential: 27, total: '115.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([]);

      const result = await documentQueryService.getCreditNotes('orig-key', mockIssuer);

      expect(result.creditedTotal).toBe('0.00');
      expect(result.remaining).toBe('115.00');
      expect(result.creditNotes).toEqual([]);
    });

    test('does not hardcode document_type — passes through whatever type the original document is', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '03', sequential: 5, total: '50.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([]);

      await documentQueryService.getCreditNotes('orig-key', mockIssuer);

      expect(documentModel.findCreditNotesByOriginalDocument).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000005', '03', expect.any(String), false);
    });
  });
});
