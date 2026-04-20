jest.mock('../../../src/config/database');

const { query } = require('../../../src/config/database');
const { checkHealth } = require('../../../src/services/health.service');

describe('health.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns { healthy: true } when DB query succeeds', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const result = await checkHealth();

    expect(result).toEqual({ healthy: true });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  test('returns { healthy: false } when DB query throws', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    const result = await checkHealth();

    expect(result).toEqual({ healthy: false });
  });
});
