jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const documentLineItemModel = require('../../../src/models/document-line-item.model');

describe('DocumentLineItemModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  describe('bulkCreate', () => {
    test('returns [] without querying when items is empty or missing', async () => {
      expect(await documentLineItemModel.bulkCreate('doc-1', [], null)).toEqual([]);
      expect(await documentLineItemModel.bulkCreate('doc-1', null, null)).toEqual([]);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('derives tax amount and line_total from rate (not a nonexistent .value field), avoiding NaN', async () => {
      const items = [{
        mainCode: '001',
        description: 'Item',
        quantity: '2',
        unitPrice: '50',
        discount: '0',
        taxes: [{ code: '2', rateCode: '2', rate: '15' }],
      }];

      await documentLineItemModel.bulkCreate('doc-1', items, null);

      const [, params] = db.query.mock.calls[0];
      // subtotal = 2*50 - 0 = 100.00 ; tax = 100 * 15/100 = 15.00 ; line_total = 115.00
      expect(params).toEqual([
        'doc-1', '001', null, 'Item', 2, 50, 0, '100.00', JSON.stringify(items[0].taxes), '115.00', '[]',
      ]);
      params.forEach((v) => expect(String(v)).not.toContain('NaN'));
    });

    test('sums tax amounts across multiple taxes on the same item', async () => {
      const items = [{
        mainCode: '001',
        description: 'Item',
        quantity: '1',
        unitPrice: '100',
        discount: '10',
        taxes: [
          { code: '2', rateCode: '2', rate: '15' },
          { code: '3', rateCode: '3050', rate: '10' },
        ],
      }];

      await documentLineItemModel.bulkCreate('doc-1', items, null);

      const [, params] = db.query.mock.calls[0];
      // subtotal = 1*100 - 10 = 90.00 ; taxes = 90*0.15 + 90*0.10 = 13.5 + 9 = 22.5 ; line_total = 112.50
      expect(params[7]).toBe('90.00');
      expect(params[9]).toBe('112.50');
    });

    test('stores additionalDetails as JSON, defaulting to an empty array when omitted', async () => {
      const items = [
        {
          mainCode: '001', description: 'A', quantity: '1', unitPrice: '10', discount: '0',
          taxes: [{ code: '2', rateCode: '0', rate: '0' }],
          additionalDetails: [{ name: 'Color', value: 'Rojo' }],
        },
        {
          mainCode: '002', description: 'B', quantity: '1', unitPrice: '10', discount: '0',
          taxes: [{ code: '2', rateCode: '0', rate: '0' }],
        },
      ];

      await documentLineItemModel.bulkCreate('doc-1', items, null);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('additional_details');
      expect(params[10]).toBe(JSON.stringify([{ name: 'Color', value: 'Rojo' }]));
      expect(params[21]).toBe('[]');
    });

    test('builds one placeholder group per item with correctly offset params', async () => {
      const items = [
        { mainCode: '001', description: 'A', quantity: '1', unitPrice: '10', discount: '0', taxes: [{ rate: '0' }] },
        { mainCode: '002', description: 'B', quantity: '1', unitPrice: '20', discount: '0', taxes: [{ rate: '0' }] },
      ];

      await documentLineItemModel.bulkCreate('doc-1', items, null);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)');
      expect(sql).toContain('($12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)');
      expect(params).toHaveLength(22);
    });

    test('uses the public/sandbox schema prefix only when no transaction client is supplied', async () => {
      const items = [{ mainCode: '001', description: 'A', quantity: '1', unitPrice: '10', discount: '0', taxes: [{ rate: '0' }] }];

      await documentLineItemModel.bulkCreate('doc-1', items, null, true);
      expect(db.query.mock.calls[0][0]).toContain('INSERT INTO sandbox.document_line_items');

      await documentLineItemModel.bulkCreate('doc-1', items, null, false);
      expect(db.query.mock.calls[1][0]).toContain('INSERT INTO public.document_line_items');

      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await documentLineItemModel.bulkCreate('doc-1', items, client, true);
      expect(client.query.mock.calls[0][0]).toContain('INSERT INTO document_line_items');
      expect(client.query.mock.calls[0][0]).not.toContain('sandbox.');
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteByDocumentId', () => {
    test('deletes line items scoped to the document via the given client', async () => {
      const client = { query: jest.fn().mockResolvedValue({}) };

      await documentLineItemModel.deleteByDocumentId('doc-1', client);

      expect(client.query).toHaveBeenCalledWith('DELETE FROM document_line_items WHERE document_id = $1', ['doc-1']);
    });
  });
});
