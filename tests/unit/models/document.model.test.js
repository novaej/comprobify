jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const documentModel = require('../../../src/models/document.model');

describe('DocumentModel.findByIssuerId', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = { query: jest.fn(), release: jest.fn() };
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ count: '2' }] });
      }
      if (sql.startsWith('SELECT * FROM documents')) {
        return Promise.resolve({ rows: [{ id: 1 }, { id: 2 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    db.getClient.mockResolvedValue(mockClient);
    db.setIssuerContext.mockResolvedValue();
  });

  function selectSql() {
    const call = mockClient.query.mock.calls.find(([sql]) => sql.startsWith('SELECT * FROM documents'));
    return call[0];
  }

  function selectParams() {
    const call = mockClient.query.mock.calls.find(([sql]) => sql.startsWith('SELECT * FROM documents'));
    return call[1];
  }

  test('defaults to ORDER BY created_at DESC when sortBy is omitted', async () => {
    await documentModel.findByIssuerId(1, {});

    expect(selectSql()).toContain('ORDER BY created_at DESC');
  });

  test('sortBy without sortDir defaults to DESC', async () => {
    await documentModel.findByIssuerId(1, { sortBy: 'sequential' });

    expect(selectSql()).toContain('ORDER BY sequential DESC');
  });

  test('maps sortBy=buyerName + sortDir=asc to buyer_name ASC', async () => {
    await documentModel.findByIssuerId(1, { sortBy: 'buyerName', sortDir: 'asc' });

    expect(selectSql()).toContain('ORDER BY buyer_name ASC');
  });

  test('maps sortBy=issueDate to issue_date column', async () => {
    await documentModel.findByIssuerId(1, { sortBy: 'issueDate', sortDir: 'asc' });

    expect(selectSql()).toContain('ORDER BY issue_date ASC');
  });

  test('maps sortBy=status to status column', async () => {
    await documentModel.findByIssuerId(1, { sortBy: 'status', sortDir: 'desc' });

    expect(selectSql()).toContain('ORDER BY status DESC');
  });

  test('adds a parameterised, zero-padded ILIKE condition for sequential filter', async () => {
    await documentModel.findByIssuerId(1, { sequential: '000123' });

    expect(selectSql()).toContain("LPAD(sequential::text, 9, '0') ILIKE '%' || $2 || '%'");
    expect(selectParams()).toEqual([1, '000123', 10, 0]);
  });

  test('adds a parameterised ILIKE condition for buyerName filter', async () => {
    await documentModel.findByIssuerId(1, { buyerName: 'acme' });

    expect(selectSql()).toContain("buyer_name ILIKE '%' || $2 || '%'");
    expect(selectParams()).toEqual([1, 'acme', 10, 0]);
  });

  test('combines sequential, buyerName, and existing filters with AND, correctly indexed', async () => {
    await documentModel.findByIssuerId(1, {
      status: 'AUTHORIZED',
      documentType: '01',
      sequential: '42',
      buyerName: 'acme',
      sortBy: 'status',
      sortDir: 'asc',
    });

    const sql = selectSql();
    expect(sql).toContain('status = $2');
    expect(sql).toContain('document_type = $3');
    expect(sql).toContain("LPAD(sequential::text, 9, '0') ILIKE '%' || $4 || '%'");
    expect(sql).toContain("buyer_name ILIKE '%' || $5 || '%'");
    expect(sql).toContain('ORDER BY status ASC');
    expect(selectParams()).toEqual([1, 'AUTHORIZED', '01', '42', 'acme', 10, 0]);
  });

  test('never string-interpolates filter values into SQL', async () => {
    await documentModel.findByIssuerId(1, { sequential: "'; DROP TABLE documents; --" });

    expect(selectSql()).not.toContain('DROP TABLE');
    expect(selectParams()).toContain("'; DROP TABLE documents; --");
  });
});

describe('DocumentModel.findCreditNotesByOriginalDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('scopes to issuer, AUTHORIZED status, document_type 04, and the originalDocument fields', async () => {
    db.queryAsIssuer.mockResolvedValue({ rows: [] });

    await documentModel.findCreditNotesByOriginalDocument(1, '01', '001-001-000000027', false);

    expect(db.queryAsIssuer).toHaveBeenCalledWith(
      1,
      expect.stringContaining("document_type = '04'"),
      [1, 'AUTHORIZED', '001-001-000000027', '01'],
      false
    );
    const sql = db.queryAsIssuer.mock.calls[0][1];
    expect(sql).toContain('issuer_id = $1');
    expect(sql).toContain('status = $2');
    expect(sql).toContain("request_payload->'originalDocument'->>'number' = $3");
    expect(sql).toContain("request_payload->'originalDocument'->>'documentType' = $4");
  });

  test('passes the sandbox flag through to queryAsIssuer', async () => {
    db.queryAsIssuer.mockResolvedValue({ rows: [] });

    await documentModel.findCreditNotesByOriginalDocument(1, '01', '001-001-000000027', true);

    expect(db.queryAsIssuer).toHaveBeenCalledWith(1, expect.any(String), expect.any(Array), true);
  });

  test('returns the matched rows', async () => {
    const rows = [{ access_key: 'a', sequential: 12, total: '30.00', issue_date: new Date('2026-04-01'), status: 'AUTHORIZED' }];
    db.queryAsIssuer.mockResolvedValue({ rows });

    const result = await documentModel.findCreditNotesByOriginalDocument(1, '01', '001-001-000000027', false);

    expect(result).toEqual(rows);
  });
});
