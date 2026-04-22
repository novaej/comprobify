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
});
