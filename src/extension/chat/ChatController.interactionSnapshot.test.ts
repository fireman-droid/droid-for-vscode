import { afterEach, expect, it } from 'vitest';
import type { HostSnapshotMessage } from '../../shared/bridgeMessages';
import { MAX_PENDING_INTERACTIONS } from '../../shared/protocol/interactions';
import { readHostMessage } from '../../webview-v2/bridge/validateHostMessage';
import { assistantWebviewReducer } from '../../webview-v2/state/store';
import { initialAssistantWebviewState } from '../../webview-v2/state/initialState';
import {
  createController, createMockRuntime, ready, send, snapshots, successfulTurn,
  waitForConnected, waitForInteraction, type RuntimeInteractionHandler,
} from './controllerTestHarness';

const controllers = new Set<ReturnType<typeof createController>['controller']>();
afterEach(async () => {
  for (const controller of controllers) await controller.dispose();
  controllers.clear();
});

async function asking() {
  let handler!: RuntimeInteractionHandler;
  const runtime = createMockRuntime(async function* () {
    await handler.askUser({
      toolCallId: 'ask-call',
      questions: [{ index: 0, topic: 'Choice', question: 'Continue?', options: ['Yes', 'No'], multiSelect: false }],
    });
    yield successfulTurn();
  });
  const result = createController((next) => { handler = next; return runtime; });
  controllers.add(result.controller);
  ready(result.controller);
  await waitForConnected(result.messages);
  send(result.controller, 'session-1', 'turn-1', 'Ask before continuing');
  const opened = await waitForInteraction(result.messages, 'ask-user');
  result.controller.emitSnapshot();
  return { ...result, opened, snapshot: snapshots(result.messages).at(-1)! };
}

function decodeSnapshot(value: unknown): HostSnapshotMessage {
  const decoded = readHostMessage(value);
  expect(decoded?.type).toBe('host.snapshot');
  if (decoded?.type !== 'host.snapshot') throw new Error('Snapshot was rejected');
  return decoded;
}

it('restores an unanswered question from an authoritative snapshot and retains it across routine snapshots', async () => {
  const { controller, messages, opened, snapshot } = await asking();
  const pending = { sessionId: opened.sessionId, turnId: opened.turnId, request: opened.request };
  expect(snapshot.interactions).toEqual([pending]);
  let state = assistantWebviewReducer(initialAssistantWebviewState, { type: 'host.message', message: decodeSnapshot(snapshot) });
  expect(state.interactions).toEqual([pending]);

  controller.emitSnapshot();
  state = assistantWebviewReducer(state, { type: 'host.message', message: decodeSnapshot(snapshots(messages).at(-1)) });
  expect(state.interactions).toEqual([pending]);
  expect(state.turn?.turnId).toBe('turn-1');
});

it('removes a settled question from a snapshot even when the view missed its close notification', async () => {
  const { controller, messages, opened, snapshot } = await asking();
  let state = assistantWebviewReducer(initialAssistantWebviewState, { type: 'host.message', message: decodeSnapshot(snapshot) });
  expect(state.interactions).toHaveLength(1);
  controller.handleMessage({ type: 'ask-user.respond', sessionId: opened.sessionId, turnId: opened.turnId,
    requestId: opened.request.requestId, cancelled: false, answers: [{ index: 0, answer: 'Yes' }] });
  controller.emitSnapshot();
  const closedSnapshot = snapshots(messages).at(-1)!;
  expect(closedSnapshot.interactions).toEqual([]);
  state = assistantWebviewReducer(state, { type: 'host.message', message: decodeSnapshot(closedSnapshot) });
  expect(state.interactions).toEqual([]);
  expect(state.transcript.filter((item) => item.kind === 'ask-user-result')).toMatchObject([{ status: 'answered' }]);
  state = assistantWebviewReducer(state, { type: 'host.message', message: decodeSnapshot(snapshot) });
  expect(state.interactions).toEqual([]);
});

it('rejects snapshot questions with a foreign identity, duplicate request, invalid request or terminal owner', async () => {
  const { opened, snapshot } = await asking();
  const pending = { sessionId: opened.sessionId, turnId: opened.turnId, request: opened.request };
  expect(readHostMessage({ ...snapshot, interactions: [pending] })?.type).toBe('host.snapshot');
  const maximum = Array.from({ length: MAX_PENDING_INTERACTIONS }, (_, index) => ({
    ...pending, request: { ...pending.request, requestId: `question-${index}` },
  }));
  expect(readHostMessage({ ...snapshot, interactions: maximum })?.type).toBe('host.snapshot');
  for (const invalid of [
    { ...snapshot, interactions: [{ ...pending, sessionId: 'other-session' }] },
    { ...snapshot, interactions: [{ ...pending, turnId: 'other-turn' }] },
    { ...snapshot, interactions: [pending, pending] },
    { ...snapshot, interactions: [{ ...pending, request: { ...pending.request, toolCallId: '' } }] },
    { ...snapshot, interactions: [pending], turn: { turnId: 'turn-1', status: 'completed' } },
    { ...snapshot, interactions: [pending], turn: null },
    { ...snapshot, interactions: [...maximum, pending] },
  ]) expect(readHostMessage(invalid)).toBeUndefined();
});

it('keeps the open plan document when its permission survives a snapshot and removes it when the request closes', async () => {
  const { snapshot } = await asking();
  const permission = {
    sessionId: 'session-1', turnId: 'turn-1', request: {
      kind: 'permission', requestId: 'plan-request',
      tools: [{ toolUseId: 'plan-tool', toolName: 'ExitSpecMode', confirmationKind: 'exit_spec_mode', title: 'Review plan' }],
      options: [{ label: 'Approve', value: 'proceed_once', requiresEditedSpec: false }],
      editableSpecContent: '# Original plan',
    },
  };
  const pending = { ...snapshot, interactions: [permission] };
  let state = assistantWebviewReducer(initialAssistantWebviewState, { type: 'host.message', message: decodeSnapshot(pending) });
  state = assistantWebviewReducer(state, { type: 'host.message', message: {
    type: 'plan.document.state', sequence: snapshot.sequence + 1, sessionId: 'session-1', turnId: 'turn-1',
    requestId: 'plan-request', status: 'ready', content: '# Edited plan',
  } });
  state = assistantWebviewReducer(state, { type: 'host.message', message: decodeSnapshot({ ...pending, sequence: snapshot.sequence + 2 }) });
  expect(state.interactions[0]?.planDocument).toEqual({ status: 'ready', content: '# Edited plan' });
  state = assistantWebviewReducer(state, { type: 'host.message', message: decodeSnapshot({ ...pending, sequence: snapshot.sequence + 3, interactions: [] }) });
  expect(state.interactions).toEqual([]);
});
