const accessKeyService = require('../../../src/services/access-key.service');

describe('AccessKeyService', () => {
  test('generates a 49-digit access key', async () => {
    const key = await accessKeyService.generate({
      issueDate: '26/02/2026',
      documentType: '01',
      ruc: '1712345678001',
      environment: '1',
      branchCode: '001',
      issuePointCode: '001',
      sequential: 263,
      emissionType: '1',
    });

    expect(key).toHaveLength(49);
    expect(key).toMatch(/^\d{49}$/);
  });

  test('starts with date in DDMMYYYY format', async () => {
    const key = await accessKeyService.generate({
      issueDate: '15/03/2026',
      documentType: '01',
      ruc: '1712345678001',
      environment: '1',
      branchCode: '001',
      issuePointCode: '001',
      sequential: 1,
      emissionType: '1',
    });

    expect(key.substring(0, 8)).toBe('15032026');
  });

  test('includes document type at position 8-9', async () => {
    const key = await accessKeyService.generate({
      issueDate: '01/01/2026',
      documentType: '04',
      ruc: '1712345678001',
      environment: '1',
      branchCode: '001',
      issuePointCode: '001',
      sequential: 1,
      emissionType: '1',
    });

    expect(key.substring(8, 10)).toBe('04');
  });

  test('includes RUC at position 10-22', async () => {
    const ruc = '1712345678001';
    const key = await accessKeyService.generate({
      issueDate: '01/01/2026',
      documentType: '01',
      ruc,
      environment: '1',
      branchCode: '001',
      issuePointCode: '001',
      sequential: 1,
      emissionType: '1',
    });

    expect(key.substring(10, 23)).toBe(ruc);
  });

  test('rejects when RUC is empty', async () => {
    await expect(
      accessKeyService.generate({
        issueDate: '01/01/2026',
        documentType: '01',
        ruc: '',
        environment: '1',
        branchCode: '001',
        issuePointCode: '001',
        sequential: 1,
        emissionType: '1',
      })
    ).rejects.toBeDefined();
  });

  test('check digit is deterministic for same inputs', async () => {
    const params = {
      issueDate: '26/02/2026',
      documentType: '01',
      ruc: '1712345678001',
      environment: '1',
      branchCode: '001',
      issuePointCode: '001',
      sequential: 100,
      emissionType: '1',
    };

    const key1 = await accessKeyService.generate(params);
    const key2 = await accessKeyService.generate(params);
    expect(key1).toBe(key2);
  });
});
