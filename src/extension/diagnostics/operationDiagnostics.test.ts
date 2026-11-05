import { expect, it, vi } from 'vitest';
import { classifyOperationError, OperationOutcomeError, recordOperation } from './operationDiagnostics';

it('projects fixed classifications without copying private error fields and rejects arbitrary operation codes', () => {
  const diagnostics = { record: vi.fn() };
  const error = Object.assign(new Error('secret-token /private/path user@example.test'), {
    status: 403, code: 'private-provider-code', model: 'private-model',
  });
  const outcome = classifyOperationError(error);
  expect(outcome).toEqual({ outcome: 'failed', failureKind: 'permission', status: 403 });
  recordOperation(diagnostics, 'models', 'saveModel', performance.now(), { ...outcome, ...{ private: error.message } });
  expect(diagnostics.record).toHaveBeenCalledExactlyOnceWith({
    name: 'host.operation.finished', level: 'warn',
    attributes: { operation: 'saveModel', surface: 'models', outcome: 'failed',
      failureKind: 'permission', status: 403, durationMs: expect.any(Number) },
  });
  recordOperation(diagnostics, 'models', 'secret-token' as 'saveModel', performance.now(), outcome);
  expect(diagnostics.record).toHaveBeenCalledOnce();
  expect(classifyOperationError(new OperationOutcomeError(error.message, { outcome: 'partial', failureKind: 'unconfirmed' })))
    .toEqual({ outcome: 'partial', failureKind: 'unconfirmed' });
  expect(classifyOperationError(new DOMException('private', 'AbortError'))).toEqual({ outcome: 'cancelled', failureKind: 'cancelled' });
  expect(classifyOperationError({ code: 'ETIMEDOUT', message: 'private' })).toEqual({ outcome: 'failed', failureKind: 'timeout' });
  expect(() => recordOperation({ record() { throw error; } }, 'review', 'review.open', performance.now(), outcome)).not.toThrow();
});
