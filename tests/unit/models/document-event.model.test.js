jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const documentEventModel = require('../../../src/models/document-event.model');

const ISSUER_ID = '00000000-0000-0000-0000-000000000007';

const mockEvent = {
  id: '00000000-0000-0000-0000-000000000001',
  document_id: '00000000-0000-0000-0000-000000000042',
  event_type: 'CREATED',
  from_status: null,
  to_status: 'SIGNED',
  detail: { accessKey: '123' },
  created_at: new Date(),
};

describe('DocumentEventModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('create inserts event row and returns it', async () => {
    db.queryAsIssuer.mockResolvedValue({ rows: [mockEvent] });

    const result = await documentEventModel.create('00000000-0000-0000-0000-000000000042', 'CREATED', null, 'SIGNED', { accessKey: '123' }, null, ISSUER_ID, true);

    expect(db.queryAsIssuer).toHaveBeenCalledWith(
      ISSUER_ID,
      expect.stringContaining('INSERT INTO document_events'),
      ['00000000-0000-0000-0000-000000000042', 'CREATED', null, 'SIGNED', JSON.stringify({ accessKey: '123' })],
      true
    );
    expect(db.query).not.toHaveBeenCalled();
    expect(result.event_type).toBe('CREATED');
    expect(result.document_id).toBe('00000000-0000-0000-0000-000000000042');
  });

  test('create passes null detail as null', async () => {
    db.queryAsIssuer.mockResolvedValue({ rows: [{ ...mockEvent, detail: null }] });

    await documentEventModel.create('00000000-0000-0000-0000-000000000042', 'SENT', 'SIGNED', 'RECEIVED', null, null, ISSUER_ID);

    expect(db.queryAsIssuer).toHaveBeenCalledWith(
      ISSUER_ID,
      expect.any(String),
      ['00000000-0000-0000-0000-000000000042', 'SENT', 'SIGNED', 'RECEIVED', null],
      false
    );
  });

  test('create uses the transaction client when one is supplied', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [mockEvent] }) };

    await documentEventModel.create('00000000-0000-0000-0000-000000000042', 'CREATED', null, 'SIGNED', null, client);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO document_events'), expect.any(Array));
    expect(db.queryAsIssuer).not.toHaveBeenCalled();
  });

  test('findByDocumentId returns events ordered by created_at', async () => {
    db.queryAsIssuer.mockResolvedValue({ rows: [mockEvent] });

    const results = await documentEventModel.findByDocumentId('00000000-0000-0000-0000-000000000042', ISSUER_ID, false);

    expect(db.queryAsIssuer).toHaveBeenCalledWith(
      ISSUER_ID,
      expect.stringContaining('ORDER BY created_at ASC'),
      ['00000000-0000-0000-0000-000000000042'],
      false
    );
    expect(results).toHaveLength(1);
    expect(results[0].event_type).toBe('CREATED');
  });
});
