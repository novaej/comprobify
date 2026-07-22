jest.mock('../../../src/models/pending-effect.model');
jest.mock('../../../src/config/database');
jest.mock('../../../src/services/queue.service');
jest.mock('../../../src/effects');

const pendingEffectModel = require('../../../src/models/pending-effect.model');
const db = require('../../../src/config/database');
const queueService = require('../../../src/services/queue.service');
const { getHandler } = require('../../../src/effects');
const AppError = require('../../../src/errors/app-error');
const config = require('../../../src/config');
const pendingEffectService = require('../../../src/services/pending-effect.service');

describe('PendingEffectService', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    db.getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueue', () => {
    test('delegates to pendingEffectModel.create with the given dedupKey', async () => {
      pendingEffectModel.create.mockResolvedValue({ id: 'effect-1', effect_type: 'WEBHOOK_FANOUT' });

      const result = await pendingEffectService.enqueue('WEBHOOK_FANOUT', { notificationId: 'n-1' }, 'dedup-1');

      expect(pendingEffectModel.create).toHaveBeenCalledWith('WEBHOOK_FANOUT', { notificationId: 'n-1' }, 'dedup-1');
      expect(result).toEqual({ id: 'effect-1', effect_type: 'WEBHOOK_FANOUT' });
    });

    test('defaults dedupKey to null when omitted', async () => {
      pendingEffectModel.create.mockResolvedValue({ id: 'effect-1' });

      await pendingEffectService.enqueue('WEBHOOK_FANOUT', { notificationId: 'n-1' });

      expect(pendingEffectModel.create).toHaveBeenCalledWith('WEBHOOK_FANOUT', { notificationId: 'n-1' }, null);
    });
  });

  describe('dispatch', () => {
    test('publishes on the routing key for the effect type and marks the row DISPATCHED', async () => {
      queueService.publishConfirmed.mockResolvedValue();
      pendingEffectModel.markDispatched.mockResolvedValue({ id: 'effect-1', status: 'DISPATCHED' });

      await pendingEffectService.dispatch({ id: 'effect-1', effect_type: 'SRI_SEND' });

      expect(queueService.publishConfirmed).toHaveBeenCalledWith('send', { effectId: 'effect-1' });
      expect(pendingEffectModel.markDispatched).toHaveBeenCalledWith('effect-1');
    });

    test('routes an unrecognized effect type to the generic effects queue', async () => {
      queueService.publishConfirmed.mockResolvedValue();

      await pendingEffectService.dispatch({ id: 'effect-2', effect_type: 'WEBHOOK_FANOUT' });

      expect(queueService.publishConfirmed).toHaveBeenCalledWith('effects', { effectId: 'effect-2' });
    });

    test('never throws when the publish fails — leaves the row for reconciliation to retry', async () => {
      queueService.publishConfirmed.mockRejectedValue(new Error('broker unreachable'));

      await expect(pendingEffectService.dispatch({ id: 'effect-3', effect_type: 'SRI_AUTHORIZE' })).resolves.toBeUndefined();
      expect(pendingEffectModel.markDispatched).not.toHaveBeenCalled();
    });
  });

  describe('process', () => {
    test('is a no-op (commits, does not call the handler) when the effect row is missing', async () => {
      pendingEffectModel.claimForProcessing.mockResolvedValue(null);

      await pendingEffectService.process('effect-missing');

      expect(getHandler).not.toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test.each(['DONE', 'FAILED'])('is a no-op when the row is already %s (benign at-least-once redelivery)', async (status) => {
      pendingEffectModel.claimForProcessing.mockResolvedValue({ id: 'effect-1', status, effect_type: 'WEBHOOK_FANOUT', attempt_count: 0 });

      await pendingEffectService.process('effect-1');

      expect(getHandler).not.toHaveBeenCalled();
      expect(pendingEffectModel.markDone).not.toHaveBeenCalled();
    });

    test('runs the handler and marks the row DONE on success', async () => {
      const effect = { id: 'effect-1', status: 'DISPATCHED', effect_type: 'WEBHOOK_FANOUT', payload: { notificationId: 'n-1' }, attempt_count: 0 };
      pendingEffectModel.claimForProcessing.mockResolvedValue(effect);
      const handler = jest.fn().mockResolvedValue(undefined);
      getHandler.mockReturnValue(handler);

      await pendingEffectService.process('effect-1');

      expect(handler).toHaveBeenCalledWith({ notificationId: 'n-1' });
      expect(pendingEffectModel.markDone).toHaveBeenCalledWith(mockClient, 'effect-1');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('leaves the row untouched (no DONE, no attempt bump) when the handler returns { requeue: true }', async () => {
      const effect = { id: 'effect-2', status: 'DISPATCHED', effect_type: 'SRI_AUTHORIZE', payload: {}, attempt_count: 0 };
      pendingEffectModel.claimForProcessing.mockResolvedValue(effect);
      const handler = jest.fn().mockResolvedValue({ requeue: true });
      getHandler.mockReturnValue(handler);

      await pendingEffectService.process('effect-2');

      expect(pendingEffectModel.markDone).not.toHaveBeenCalled();
      expect(pendingEffectModel.recordFailedAttempt).not.toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    test('treats a benign state-transition error (400 AppError) as success — marks DONE, does not rethrow', async () => {
      const effect = { id: 'effect-3', status: 'DISPATCHED', effect_type: 'SRI_SEND', payload: {}, attempt_count: 2 };
      pendingEffectModel.claimForProcessing.mockResolvedValue(effect);
      const handler = jest.fn().mockRejectedValue(new AppError('already processed', 400, 'INVALID_STATE_TRANSITION'));
      getHandler.mockReturnValue(handler);

      await expect(pendingEffectService.process('effect-3')).resolves.toBeUndefined();

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(pendingEffectModel.recordFailedAttempt).toHaveBeenCalledWith('effect-3', 2, null, 'DONE');
    });

    test('a genuine failure increments attempt_count, keeps status for retry below maxAttempts, and rethrows', async () => {
      const effect = { id: 'effect-4', status: 'DISPATCHED', effect_type: 'WEBHOOK_FANOUT', payload: {}, attempt_count: 1 };
      pendingEffectModel.claimForProcessing.mockResolvedValue(effect);
      const err = new Error('endpoint timed out');
      const handler = jest.fn().mockRejectedValue(err);
      getHandler.mockReturnValue(handler);

      await expect(pendingEffectService.process('effect-4')).rejects.toThrow('endpoint timed out');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      // attempt_count 1 -> 2, below the default maxAttempts (5), so status stays DISPATCHED
      expect(pendingEffectModel.recordFailedAttempt).toHaveBeenCalledWith('effect-4', 2, 'endpoint timed out', 'DISPATCHED');
    });

    test('marks the row FAILED once attempt_count reaches maxAttempts', async () => {
      const effect = { id: 'effect-5', status: 'DISPATCHED', effect_type: 'WEBHOOK_FANOUT', payload: {}, attempt_count: config.pendingEffects.maxAttempts - 1 };
      pendingEffectModel.claimForProcessing.mockResolvedValue(effect);
      const handler = jest.fn().mockRejectedValue(new Error('still failing'));
      getHandler.mockReturnValue(handler);

      await expect(pendingEffectService.process('effect-5')).rejects.toThrow('still failing');

      expect(pendingEffectModel.recordFailedAttempt).toHaveBeenCalledWith(
        'effect-5', config.pendingEffects.maxAttempts, 'still failing', 'FAILED'
      );
    });

    test('always releases the claiming client, even on failure', async () => {
      const effect = { id: 'effect-6', status: 'DISPATCHED', effect_type: 'WEBHOOK_FANOUT', payload: {}, attempt_count: 0 };
      pendingEffectModel.claimForProcessing.mockResolvedValue(effect);
      const handler = jest.fn().mockRejectedValue(new Error('boom'));
      getHandler.mockReturnValue(handler);

      await expect(pendingEffectService.process('effect-6')).rejects.toThrow('boom');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
