jest.mock('../../../src/config/database');
jest.mock('../../../src/services/queue.service');
jest.mock('../../../src/models/pending-effect.model');

const db = require('../../../src/config/database');
const queueService = require('../../../src/services/queue.service');
const pendingEffectModel = require('../../../src/models/pending-effect.model');
const config = require('../../../src/config');
const queueReconciliationService = require('../../../src/services/queue-reconciliation.service');

describe('QueueReconciliationService', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    db.getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('finds stale rows using the configured thresholds and republishes each on its own routing key', async () => {
    pendingEffectModel.findStaleForReconciliation.mockResolvedValue([
      { id: 'effect-1', effect_type: 'SRI_SEND' },
      { id: 'effect-2', effect_type: 'SRI_AUTHORIZE' },
      { id: 'effect-3', effect_type: 'WEBHOOK_FANOUT' },
    ]);
    queueService.publishConfirmed.mockResolvedValue();

    const result = await queueReconciliationService.runAll();

    expect(pendingEffectModel.findStaleForReconciliation).toHaveBeenCalledWith(mockClient, {
      checkDelayMinutes: config.queueReconciliation.authorizeCheckDelayMinutes,
      staleMinutes: config.queueReconciliation.authorizeStaleMinutes,
      effectStaleMinutes: config.queueReconciliation.effectStaleMinutes,
      batchLimit: config.queueReconciliation.batchLimit,
    });
    expect(queueService.publishConfirmed).toHaveBeenCalledWith('send', { effectId: 'effect-1' });
    expect(queueService.publishConfirmed).toHaveBeenCalledWith('authorize', { effectId: 'effect-2' });
    expect(queueService.publishConfirmed).toHaveBeenCalledWith('effects', { effectId: 'effect-3' });
    expect(mockClient.query).toHaveBeenCalledWith(
      `UPDATE pending_effects SET status = 'DISPATCHED', dispatch_attempted_at = NOW() WHERE id = $1`,
      ['effect-1']
    );
    expect(result).toEqual({ republished: 3 });
  });

  test('leaves a row untouched and keeps going when one republish fails', async () => {
    pendingEffectModel.findStaleForReconciliation.mockResolvedValue([
      { id: 'effect-1', effect_type: 'WEBHOOK_FANOUT' },
      { id: 'effect-2', effect_type: 'WEBHOOK_FANOUT' },
    ]);
    queueService.publishConfirmed
      .mockRejectedValueOnce(new Error('broker unreachable'))
      .mockResolvedValueOnce();

    const result = await queueReconciliationService.runAll();

    expect(result).toEqual({ republished: 1 });
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE'), ['effect-1']);
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE'), ['effect-2']);
  });

  test('reports zero and commits when nothing is stale', async () => {
    pendingEffectModel.findStaleForReconciliation.mockResolvedValue([]);

    const result = await queueReconciliationService.runAll();

    expect(result).toEqual({ republished: 0 });
    expect(queueService.publishConfirmed).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('rolls back and rethrows if the sweep query itself fails', async () => {
    pendingEffectModel.findStaleForReconciliation.mockRejectedValue(new Error('query failed'));

    await expect(queueReconciliationService.runAll()).rejects.toThrow('query failed');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
