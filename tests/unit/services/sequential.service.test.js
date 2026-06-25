jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const sequentialService = require('../../../src/services/sequential.service');

describe('SequentialService', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(mockClient);
    db.setIssuerContext = jest.fn().mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('increments existing sequential value', async () => {
    // BEGIN
    mockClient.query.mockResolvedValueOnce({});
    // SELECT FOR UPDATE — row exists with value 5
    mockClient.query.mockResolvedValueOnce({ rows: [{ current_value: 5 }] });
    // UPDATE
    mockClient.query.mockResolvedValueOnce({});
    // COMMIT
    mockClient.query.mockResolvedValueOnce({});

    const result = await sequentialService.getNext(1, '001', '001', '01');
    expect(result).toBe(6);
    expect(db.setIssuerContext).toHaveBeenCalledWith(mockClient, 1, false);
    expect(mockClient.query).toHaveBeenCalledTimes(4);
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('creates new sequential starting at 1 when no row exists', async () => {
    // BEGIN
    mockClient.query.mockResolvedValueOnce({});
    // SELECT FOR UPDATE — no rows
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockClient.query.mockResolvedValueOnce({});
    // COMMIT
    mockClient.query.mockResolvedValueOnce({});

    const result = await sequentialService.getNext(1, '001', '001', '01');
    expect(result).toBe(1);
  });

  test('rolls back on error and re-throws', async () => {
    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockRejectedValueOnce(new Error('DB error')); // SELECT fails

    // ROLLBACK
    mockClient.query.mockResolvedValueOnce({});

    await expect(sequentialService.getNext(1, '001', '001', '01')).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('uses external client without its own transaction', async () => {
    const externalClient = {
      query: jest.fn().mockResolvedValue({ rows: [{ current_value: 10 }] }),
      release: jest.fn(),
    };
    // Second call is UPDATE
    externalClient.query.mockResolvedValueOnce({ rows: [{ current_value: 10 }] });
    externalClient.query.mockResolvedValueOnce({});

    const result = await sequentialService.getNext(1, '001', '001', '01', externalClient);
    expect(result).toBe(11);
    // No BEGIN/COMMIT/SET LOCAL when an external client is provided
    expect(db.setIssuerContext).not.toHaveBeenCalled();
    expect(externalClient.release).not.toHaveBeenCalled();
  });

  describe('getCounters', () => {
    test('merges sandbox and production values per document type, defaulting missing rows to 0', async () => {
      db.queryAsIssuer
        .mockResolvedValueOnce({ rows: [{ document_type: '01', current_value: 5 }] }) // production
        .mockResolvedValueOnce({ rows: [{ document_type: '04', current_value: 2 }] }); // sandbox

      const result = await sequentialService.getCounters(1, ['01', '04']);

      expect(result).toEqual([
        { documentType: '01', sandbox: { current: 0, next: 1 }, production: { current: 5, next: 6 } },
        { documentType: '04', sandbox: { current: 2, next: 3 }, production: { current: 0, next: 1 } },
      ]);
      expect(db.queryAsIssuer).toHaveBeenNthCalledWith(
        1,
        1,
        expect.stringContaining('SELECT document_type, current_value FROM sequential_numbers'),
        [1],
        false
      );
      expect(db.queryAsIssuer).toHaveBeenNthCalledWith(
        2,
        1,
        expect.stringContaining('SELECT document_type, current_value FROM sequential_numbers'),
        [1],
        true
      );
    });
  });

  describe('setNext', () => {
    test('updates an existing counter when nextSequential is greater than current', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [{ current_value: 5 }] }); // SELECT FOR UPDATE
      mockClient.query.mockResolvedValueOnce({}); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      await sequentialService.setNext(1, '001', '001', '01', 10, false);

      expect(db.setIssuerContext).toHaveBeenCalledWith(mockClient, 1, false);
      expect(mockClient.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE sequential_numbers SET current_value'),
        [9, 1, '001', '001', '01']
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('inserts a new counter when no row exists yet', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      await sequentialService.setNext(1, '001', '001', '01', 3, true);

      expect(db.setIssuerContext).toHaveBeenCalledWith(mockClient, 1, true);
      expect(mockClient.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO sequential_numbers'),
        [1, '001', '001', '01', 2]
      );
    });

    test('rejects and rolls back when nextSequential does not exceed current', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [{ current_value: 5 }] }); // SELECT FOR UPDATE
      mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

      await expect(sequentialService.setNext(1, '001', '001', '01', 5, false))
        .rejects.toMatchObject({ statusCode: 400, code: 'SEQUENTIAL_CANNOT_DECREASE' });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
