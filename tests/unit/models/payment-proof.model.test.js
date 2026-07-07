jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const paymentProofModel = require('../../../src/models/payment-proof.model');

const mockProof = {
  id: 1,
  payment_id: 20,
  file: Buffer.from('x'),
  filename: 'receipt.pdf',
  mime_type: 'application/pdf',
  active: true,
  created_at: new Date(),
};

describe('PaymentProofModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createMany', () => {
    test('returns an empty array without querying when given no files', async () => {
      const result = await paymentProofModel.createMany(20, []);

      expect(result).toEqual([]);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('bulk-inserts one row per file with correctly offset placeholders', async () => {
      db.query.mockResolvedValue({ rows: [mockProof, { ...mockProof, id: 2, filename: 'back.pdf' }] });
      const files = [
        { buffer: Buffer.from('a'), filename: 'front.pdf', mimeType: 'application/pdf' },
        { buffer: Buffer.from('b'), filename: 'back.pdf', mimeType: 'application/pdf' },
      ];

      const result = await paymentProofModel.createMany(20, files, 'REF-123');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)');
      expect(params).toEqual([
        20, files[0].buffer, 'front.pdf', 'application/pdf', 'REF-123',
        20, files[1].buffer, 'back.pdf', 'application/pdf', 'REF-123',
      ]);
      expect(result).toHaveLength(2);
    });
  });

  test('findActiveByPaymentId only returns active rows, oldest first', async () => {
    db.query.mockResolvedValue({ rows: [mockProof] });

    const result = await paymentProofModel.findActiveByPaymentId(20);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('active = true'),
      [20]
    );
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at ASC'), [20]);
    expect(result).toEqual([mockProof]);
  });

  test('findAllByPaymentId returns rows regardless of active state', async () => {
    db.query.mockResolvedValue({ rows: [mockProof, { ...mockProof, id: 2, active: false }] });

    const result = await paymentProofModel.findAllByPaymentId(20);

    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toContain('active = true');
    expect(result).toHaveLength(2);
  });

  test('findByIdAndPaymentId scopes the lookup to both id and payment_id', async () => {
    db.query.mockResolvedValue({ rows: [mockProof] });

    const result = await paymentProofModel.findByIdAndPaymentId(1, 20);

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [1, 20]);
    expect(result).toEqual(mockProof);
  });

  test('findByIdAndPaymentId returns null when not found', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await paymentProofModel.findByIdAndPaymentId(999, 20);

    expect(result).toBeNull();
  });

  test('countActiveByPaymentId returns the numeric count', async () => {
    db.query.mockResolvedValue({ rows: [{ count: 3 }] });

    const result = await paymentProofModel.countActiveByPaymentId(20);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('active = true'), [20]);
    expect(result).toBe(3);
  });

  describe('softDelete', () => {
    test('sets active = false and returns the updated row', async () => {
      db.query.mockResolvedValue({ rows: [{ ...mockProof, active: false }] });

      const result = await paymentProofModel.softDelete(1, 20);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('SET active = false');
      expect(sql).toContain('active = true'); // only affects a currently-active row
      expect(params).toEqual([1, 20]);
      expect(result.active).toBe(false);
    });

    test('is a no-op (returns null) when the row does not exist or is already inactive', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const result = await paymentProofModel.softDelete(999, 20);

      expect(result).toBeNull();
    });
  });
});
