jest.mock('../../../src/config/database');

const db = require('../../../src/config/database');
const documentEventModel = require('../../../src/models/document-event.model');

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
    db.query.mockResolvedValue({ rows: [mockEvent] });

    const result = await documentEventModel.create('00000000-0000-0000-0000-000000000042', 'CREATED', null, 'SIGNED', { accessKey: '123' });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.document_events'),
      ['00000000-0000-0000-0000-000000000042', 'CREATED', null, 'SIGNED', JSON.stringify({ accessKey: '123' })]
    );
    expect(result.event_type).toBe('CREATED');
    expect(result.document_id).toBe('00000000-0000-0000-0000-000000000042');
  });

  test('create passes null detail as null', async () => {
    db.query.mockResolvedValue({ rows: [{ ...mockEvent, detail: null }] });

    await documentEventModel.create('00000000-0000-0000-0000-000000000042', 'SENT', 'SIGNED', 'RECEIVED', null);

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      ['00000000-0000-0000-0000-000000000042', 'SENT', 'SIGNED', 'RECEIVED', null]
    );
  });

  test('findByDocumentId returns events ordered by created_at', async () => {
    db.query.mockResolvedValue({ rows: [mockEvent] });

    const results = await documentEventModel.findByDocumentId('00000000-0000-0000-0000-000000000042');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at ASC'),
      ['00000000-0000-0000-0000-000000000042']
    );
    expect(results).toHaveLength(1);
    expect(results[0].event_type).toBe('CREATED');
  });
});
