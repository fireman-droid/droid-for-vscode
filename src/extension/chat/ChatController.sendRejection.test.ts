import { expect, it, vi } from 'vitest';
import type { RuntimeSessionSettings } from '../../runtime/DroidRuntime';
import { TURN_SEND_REJECTED_CODE } from '../../shared/protocol/turns';
import { createController, createMockRuntime, deferred, lastMessage, ready, send, successfulTurn, waitForConnected } from './controllerTestHarness';

it('reports the rejected request while settings update and accepts a resend after completion', async () => {
  const runtime = createMockRuntime();
  const update = deferred<RuntimeSessionSettings>();
  runtime.updateSessionSetting.mockReturnValue(update.promise);
  const { controller, messages } = createController(() => runtime);
  ready(controller);
  await waitForConnected(messages);
  await vi.waitFor(() => expect(lastMessage(messages, 'session.settings')?.settings.status).toBe('ready'));
  controller.handleMessage({ type: 'session.setting.update', sessionId: 'session-1', field: 'interactionMode', value: 'spec' });
  send(controller, 'session-1', 'rejected-1', 'Keep this question');
  expect(runtime.sendTurn).not.toHaveBeenCalled();
  expect(lastMessage(messages, 'turn.error')).toMatchObject({
    sessionId: 'session-1', turnId: 'rejected-1', code: TURN_SEND_REJECTED_CODE, retryable: true,
  });
  update.resolve({ modelId: 'model-1', interactionMode: 'spec', reasoningEffort: 'high', autonomyLevel: 'medium', specModeModelId: null, specModeReasoningEffort: null });
  await vi.waitFor(() => expect(lastMessage(messages, 'session.settings')?.settings.status).toBe('ready'));
  send(controller, 'session-1', 'retry-1', 'Keep this question');
  await vi.waitFor(() => expect(runtime.sendTurn).toHaveBeenCalledExactlyOnceWith('Keep this question', undefined));
  controller.dispose();
});

it('acknowledges a duplicate accepted request without failing or sending the active turn twice', async () => {
  const completion = deferred<void>();
  const runtime = createMockRuntime(async function* () { await completion.promise; yield successfulTurn(); });
  const { controller, messages } = createController(() => runtime);
  ready(controller);
  await waitForConnected(messages);
  send(controller, 'session-1', 'same-turn', 'One question');
  await vi.waitFor(() => expect(runtime.sendTurn).toHaveBeenCalledOnce());
  send(controller, 'session-1', 'same-turn', 'One question');
  expect(runtime.sendTurn).toHaveBeenCalledOnce();
  expect(lastMessage(messages, 'turn.error')).toBeUndefined();
  expect(lastMessage(messages, 'turn.state')).toMatchObject({ turnId: 'same-turn', status: 'submitting' });
  completion.resolve();
  await vi.waitFor(() => expect(lastMessage(messages, 'turn.state')?.status).toBe('completed'));
  controller.dispose();
});
