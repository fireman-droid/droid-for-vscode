// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION, type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import { readHostMessage } from '../../bridge/validateHostMessage';
import { assistantWebviewReducer, initialAssistantWebviewState } from '../../state/store';
import type { StudioScenarioId } from '../scenarios';
import { createPreviewRuntime } from './runtime';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup(scenario: StudioScenarioId = 'conversation') {
  vi.useFakeTimers();
  const network = vi.fn(() => { throw new Error('Simulation attempted live access'); });
  vi.stubGlobal('fetch', network); vi.stubGlobal('WebSocket', network);
  vi.stubGlobal('EventSource', network); vi.stubGlobal('acquireVsCodeApi', network);
  const runtime = createPreviewRuntime({ scenario, theme: 'dark', width: 480 }, { notice: vi.fn(), navigate: vi.fn() });
  let state = initialAssistantWebviewState;
  const events: HostToWebviewMessage[] = [];
  runtime.subscribe(value => {
    const message = readHostMessage(value);
    expect(message, JSON.stringify(value)).toBeTruthy();
    if (!message) return;
    events.push(message);
    if ('sequence' in message) state = assistantWebviewReducer(state, { type: 'host.message', message });
  });
  const post = (value: Record<string, unknown>) => runtime.postMessage({ sessionId: 'studio-session', ...value });
  runtime.postMessage({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION });
  await Promise.resolve();
  return { runtime, post, events, network, state: () => state, optimisticSend(turnId: string) {
    state = assistantWebviewReducer(state, { type: 'turn.send', turnId, text: 'Example prompt' });
    post({ type: 'turn.send', turnId, text: 'Example prompt' });
  } };
}

it('streams validated events through the production reducer and dispatches the queued turn in order', async () => {
  const h = await setup();
  h.optimisticSend('first');
  await Promise.resolve();
  expect(h.state().turn).toMatchObject({ turnId: 'first', status: 'streaming' });
  expect(h.state().pendingTurnId).toBeNull();
  h.post({ type: 'queue.add', queueId: 'second', text: 'A queued example' });
  await vi.advanceTimersByTimeAsync(8000);
  expect(h.state().transcript).toContainEqual(expect.objectContaining({ kind: 'tool', toolName: 'Task', status: 'running' }));
  expect(h.events.some(event => event.type === 'subagent.activity')).toBe(true);
  h.post({ type: 'subagent.inspect', turnId: 'first', toolUseId: 'preview-Task' });
  await Promise.resolve();
  expect(h.events.at(-1)).toMatchObject({ type: 'subagent.snapshot', status: 'ready', running: true,
    items: expect.arrayContaining([expect.objectContaining({ kind: 'assistant' }), expect.objectContaining({ kind: 'tool' })]) });
  await vi.advanceTimersByTimeAsync(4000);
  expect(h.events.filter(event => event.type === 'subagent.snapshot').at(-1)).toMatchObject({ running: false, lifecycle: 'completed' });
  h.post({ type: 'subagent.inspect', turnId: 'first', toolUseId: null });
  const childSnapshots = h.events.filter(event => event.type === 'subagent.snapshot').length;
  expect(h.state().turn).toMatchObject({ turnId: 'second', status: 'streaming' });
  expect(h.state().transcript).toContainEqual(expect.objectContaining({ kind: 'user', text: 'A queued example' }));
  expect(h.state().queue.items).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(12000);
  expect(h.state().turn?.status).toBe('completed');
  expect(h.events.filter(event => event.type === 'subagent.snapshot')).toHaveLength(childSnapshots);
  const sequences = h.events.flatMap(event => 'sequence' in event ? [event.sequence] : []);
  expect(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]!)).toBe(true);
  expect(h.network).not.toHaveBeenCalled();
  h.runtime.dispose();
});

it('stops in-flight tools, retains a paused queue and resumes only on explicit intent', async () => {
  const h = await setup();
  h.optimisticSend('stopped');
  h.post({ type: 'queue.add', queueId: 'next', text: 'Next example' });
  await vi.advanceTimersByTimeAsync(7500);
  h.post({ type: 'subagent.inspect', turnId: 'stopped', toolUseId: 'preview-Task' });
  h.post({ type: 'turn.stop', turnId: 'stopped' });
  await Promise.resolve();
  expect(h.state().turn?.status).toBe('interrupted');
  expect(h.state().queue.paused).toBe('stopped');
  expect(h.events.filter(event => event.type === 'subagent.snapshot').at(-1)).toMatchObject({ running: false, lifecycle: 'cancelled' });
  expect(h.state().transcript).toContainEqual(expect.objectContaining({ kind: 'tool', toolName: 'Task', status: 'stopped' }));
  const count = h.events.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(h.events).toHaveLength(count);
  h.post({ type: 'queue.resume' });
  await vi.advanceTimersByTimeAsync(12000);
  expect(h.state().turn).toMatchObject({ turnId: 'next', status: 'completed' });
  h.runtime.dispose();
});

it('invalidates pending deliveries and timers on reset, navigation and disposal', async () => {
  const h = await setup('empty');
  h.optimisticSend('old');
  h.runtime.replay();
  await Promise.resolve();
  expect(h.state().turn).toBeNull();
  expect(h.state().transcript).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(13000);
  expect(h.state().transcript).toHaveLength(0);
  h.optimisticSend('navigate');
  h.runtime.suspend();
  const count = h.events.length;
  await vi.advanceTimersByTimeAsync(13000);
  expect(h.events).toHaveLength(count);
  h.runtime.replay();
  await Promise.resolve();
  h.post({ type: 'turn.send', turnId: 'foreign', sessionId: 'other', text: 'Wrong session' });
  h.post({ type: 'turn.send', turnId: 'malformed', text: 123 });
  await vi.advanceTimersByTimeAsync(13000);
  expect(h.state().turn).toBeNull();
  h.optimisticSend('dispose');
  h.runtime.dispose();
  const disposedCount = h.events.length;
  await vi.advanceTimersByTimeAsync(13000);
  expect(h.events).toHaveLength(disposedCount);
  expect(h.network).not.toHaveBeenCalled();
});

it.each(['permission', 'ask-user'] as const)('settles the existing %s card before continuing the simulation', async scenario => {
  const h = await setup(scenario);
  const pending = h.state().interactions[0]!;
  const response = scenario === 'permission'
    ? { type: 'permission.respond', selectedOption: 'proceed_once' }
    : { type: 'ask-user.respond', cancelled: false, answers: [{ index: 0, answer: 'Dark' }, { index: 1, answer: '480' }, { index: 2, answer: 'Example' }] };
  h.post({ ...response, turnId: pending.turnId, requestId: 'stale-request' });
  await vi.advanceTimersByTimeAsync(13000);
  expect(h.state().interactions).toHaveLength(1);
  h.post({ ...response, turnId: pending.turnId, requestId: pending.request.requestId });
  await vi.advanceTimersByTimeAsync(12000);
  expect(h.state().interactions).toHaveLength(0);
  expect(h.state().turn?.status).toBe('completed');
  expect(h.network).not.toHaveBeenCalled();
  h.runtime.dispose();
});
