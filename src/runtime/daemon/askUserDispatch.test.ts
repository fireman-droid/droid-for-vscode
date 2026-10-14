import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskUserResult, DaemonSessionController, PendingAskUserRequest } from '@factory/droid-sdk';
import { PendingInteractionCoordinator } from '../../extension/interactions/pendingInteractionCoordinator';
import { createRuntimeInteractionCallbacks } from '../events/runtimeInteractions';
import { bindDaemonAskUser } from './askUserDispatch';
import type { RetainedDaemonSession } from './sessionHandle';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });
const result: AskUserResult = { answers: [{ index: 0, question: 'Continue?', answer: 'Yes' }] };
function fixture() {
  const opened = vi.fn(), closed = vi.fn(), report = vi.fn();
  const coordinator = new PendingInteractionCoordinator(opened, closed);
  const callbacks = createRuntimeInteractionCallbacks(coordinator.createRuntimeHandler());
  const askUserHandler = vi.fn(callbacks.askUserHandler);
  const owner = { handlers: { askUserHandler }, reportError: vi.fn() } as unknown as RetainedDaemonSession;
  coordinator.beginTurn('session', 'turn');
  const pending = new Map<string, PendingAskUserRequest>();
  const controller = Object.assign(new EventEmitter(), {
    getPendingAskUserRequests: () => [...pending.values()],
    respondToAskUser: vi.fn(async (_input: { requestId: string; sessionId: string; result: AskUserResult }) => {}),
  });
  let revision = 0;
  const transport = { waitUntilReady: vi.fn(async () => {}), revision: () => revision, isReady: () => true };
  const dispose = bindDaemonAskUser(controller as unknown as DaemonSessionController,
    new Map([['session', owner]]), report, transport);
  cleanups.push(dispose);
  const request = (requestId = 'original', toolCallId = 'tool') => {
    const value = { requestId, toolCallId, sessionId: 'session', timestamp: Date.now(),
      questions: [{ index: 0, topic: 'Continue', question: 'Continue?', options: ['Yes', 'No'], multiSelect: false }] };
    pending.set(requestId, value);
    controller.emit('askUserRequested', value);
    return value;
  };
  const resolve = (id: string, answer?: AskUserResult) => {
    pending.delete(id);
    controller.emit('askUserResolved', id, answer);
  };
  const answer = () => coordinator.respondAskUser({ type: 'ask-user.respond', sessionId: 'session', turnId: 'turn',
    requestId: coordinator.snapshotPending()[0]!.request.requestId, cancelled: false, answers: [{ index: 0, answer: 'Yes' }] });
  return { controller, coordinator, opened, closed, report, owner, askUserHandler, request, resolve, answer,
    transport, dispose, nextRevision: () => { revision++; } };
}

describe('AskUser lifecycle across idle-session resume', () => {
  it('submits a normal answer once and does not reopen a later replay of that tool call', async () => {
    const f = fixture();
    f.request();
    expect(f.answer()).toBe(true);
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledOnce());
    f.resolve('original', result);
    f.request('restored');
    expect(f.opened).toHaveBeenCalledOnce();
    expect(f.coordinator.snapshotPending()).toEqual([]);
    expect(f.closed.mock.calls[0]![0].result.status).toBe('answered');
    expect(f.report).not.toHaveBeenCalled();
  });

  it('leaves buffered answers to the SDK when an idle session self-resumes with a new request ID', async () => {
    const f = fixture();
    f.controller.respondToAskUser.mockImplementationOnce(async input => {
      // SDK: save buffered answer, resolve old request, then self-resume and
      // emit a restored prompt before replaying the buffer into the worker.
      f.resolve(input.requestId, input.result);
      f.request('after-lunch');
      await Promise.resolve();
      f.resolve('after-lunch', input.result);
    });
    f.request();
    f.answer();
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledOnce());
    expect(f.opened).toHaveBeenCalledOnce();
    expect(f.closed).toHaveBeenCalledOnce();
    expect(f.coordinator.hasPending()).toBe(false);
    expect(f.report).not.toHaveBeenCalled();
  });

  it.each(['original', 'replacement'])('preserves the unanswered form through snapshot replay as %s', async id => {
    const f = fixture();
    f.request();
    const form = f.coordinator.snapshotPending()[0];
    f.resolve('original');
    f.request(id);
    await Promise.resolve();
    expect(f.opened).toHaveBeenCalledOnce();
    expect(f.coordinator.snapshotPending()).toEqual([form]);
    f.answer();
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledWith({
      requestId: id, sessionId: 'session', result,
    }));
    expect(f.report).not.toHaveBeenCalled();
  });

  it('withdraws a removed prompt from the host snapshot without inventing a cancellation or sending a stale response', async () => {
    const f = fixture();
    f.request();
    f.resolve('original');
    await vi.waitFor(() => expect(f.coordinator.hasPending()).toBe(false));
    expect(f.closed.mock.calls[0]![0]).not.toHaveProperty('result');
    expect(f.controller.respondToAskUser).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });

  it('withdraws questions resolved by another client and ignores their replay', async () => {
    const f = fixture();
    f.request();
    f.resolve('original', result);
    f.request('restored');
    await vi.waitFor(() => expect(f.coordinator.hasPending()).toBe(false));
    expect(f.opened).toHaveBeenCalledOnce();
    expect(f.controller.respondToAskUser).not.toHaveBeenCalled();
    expect(f.closed.mock.calls[0]![0]).not.toHaveProperty('result');
  });

  it('does not reuse old wire IDs when an answer is waiting for transport recovery', async () => {
    const f = fixture();
    let ready!: () => void;
    f.transport.waitUntilReady.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
    f.request();
    f.answer();
    await vi.waitFor(() => expect(f.transport.waitUntilReady).toHaveBeenCalled());
    f.resolve('original');
    f.request('reconnected');
    ready();
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledWith({
      requestId: 'reconnected', sessionId: 'session', result,
    }));
    expect(f.opened).toHaveBeenCalledOnce();
  });

  it('reuses the answer only for a confirmed recovery replay after an ambiguous RPC failure', async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    f.controller.respondToAskUser.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    f.request(); f.answer();
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledOnce());
    f.nextRevision();
    f.resolve('original'); f.request('reconnected');
    reject(new Error('old transport closed'));
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledTimes(2));
    expect(f.controller.respondToAskUser).toHaveBeenLastCalledWith({ requestId: 'reconnected', sessionId: 'session', result });
    expect(f.opened).toHaveBeenCalledOnce();
    expect(f.report.mock.calls[0]![1]).toBeUndefined();
  });

  it('resolution wins over an old failed RPC and unrelated new questions still work', async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    f.controller.respondToAskUser.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    f.request(); f.answer();
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledOnce());
    f.resolve('original', result);
    f.request('restored');
    reject(new Error('old RPC lost its acknowledgement'));
    f.request('new-question', 'different-tool');
    expect(f.opened).toHaveBeenCalledTimes(2);
    f.answer();
    await vi.waitFor(() => expect(f.controller.respondToAskUser).toHaveBeenCalledTimes(2));
    expect(f.report).not.toHaveBeenCalled();
  });

  it('still reports a genuine submission failure on the current connection', async () => {
    const f = fixture();
    const error = new Error('response rejected');
    f.controller.respondToAskUser.mockRejectedValueOnce(error);
    f.request(); f.answer();
    await vi.waitFor(() => expect(f.report).toHaveBeenCalledWith(error, f.owner));
    expect(f.controller.respondToAskUser).toHaveBeenCalledOnce();
  });

  it('withdraws pending forms on disconnect without responding after disposal', async () => {
    const f = fixture();
    f.request(); f.dispose();
    await vi.waitFor(() => expect(f.coordinator.hasPending()).toBe(false));
    expect(f.controller.respondToAskUser).not.toHaveBeenCalled();
  });
});
