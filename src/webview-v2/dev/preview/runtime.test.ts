// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION } from '../../../shared/bridgeMessages';
import { MANAGEMENT_VERSION, parseManagementHostMessage } from '../../../shared/protocol/managementPageProtocol';
import { MODEL_MANAGER_VERSION, parseModelsHostMessage } from '../../../shared/protocol/modelManagerProtocol';
import { isReviewPanelFile } from '../../../shared/protocol/reviewPanelProtocol';
import { parseReviewQuestionResponse } from '../../../shared/protocol/reviewQuestionProtocol';
import { readHostMessage } from '../../bridge/validateHostMessage';
import { createPreviewRuntime, PREVIEW_NOTICE } from './runtime';

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
function setup() {
  const fetch = vi.fn(() => { throw new Error('Unexpected network request'); });
  const acquire = vi.fn(() => { throw new Error('Unexpected VS Code API'); });
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('acquireVsCodeApi', acquire);
  vi.stubGlobal('EventSource', vi.fn(() => { throw new Error('Unexpected live stream'); }));
  sessionStorage.setItem('dvx.browser-dev.connection', '{"port":12345,"token":"test-only"}');
  const notice = vi.fn(), navigate = vi.fn();
  const runtime = createPreviewRuntime({ scenario: 'full-workflow', theme: 'dark', width: 480 }, { notice, navigate });
  const receive = vi.fn();
  runtime.subscribe(receive);
  const emitted = () => receive.mock.calls.map(([message]) => message);
  return { runtime, notice, navigate, emitted, receive, fetch, acquire };
}
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

it('boots validated production state and replays child activity after subscription without live access', async () => {
  const h = setup();
  h.runtime.postMessage({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION, pageId: 'preview' });
  await flush();
  const snapshot = h.emitted().find(message => message.type === 'host.snapshot');
  expect(readHostMessage(snapshot)).toMatchObject({ type: 'host.snapshot', sessionId: 'studio-session' });
  expect(snapshot.transcript.some((item: { kind: string }) => item.kind === 'tool')).toBe(true);
  h.receive.mockClear();
  h.runtime.postMessage({ type: 'subagent.panel', sessionId: 'studio-session' });
  await flush();
  expect(h.emitted().map(readHostMessage)).toContainEqual(expect.objectContaining({ type: 'subagent.activity' }));
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.acquire).not.toHaveBeenCalled();
  h.runtime.dispose();
});

it('rejects model verification, saved settings and chat sends with correlated results and no changes', async () => {
  const h = setup();
  h.runtime.postMessage({ type: 'models.request', version: MODEL_MANAGER_VERSION, requestId: 'verify',
    action: { kind: 'verifyModel', rawIndex: 0, expectedModel: 'gateway-reasoner', connectionId: 'gateway' } });
  h.runtime.postMessage({ type: 'management.request', version: MANAGEMENT_VERSION, requestId: 'save',
    action: { kind: 'theme.set', theme: 'light' } });
  h.runtime.postMessage({ type: 'turn.send', sessionId: 'studio-session', turnId: 'send', text: 'Do real work' });
  h.runtime.postMessage({ type: 'queue.add', sessionId: 'studio-session', queueId: 'queue', text: 'Do real work later' });
  await flush();
  expect(h.emitted().map(parseModelsHostMessage)).toContainEqual(expect.objectContaining({ requestId: 'verify', ok: false }));
  expect(h.emitted().map(parseManagementHostMessage)).toContainEqual(expect.objectContaining({ requestId: 'save', ok: false }));
  expect(h.emitted().map(readHostMessage)).toContainEqual(expect.objectContaining({ type: 'turn.error', turnId: 'send', code: 'turn-send-rejected' }));
  expect(h.emitted().map(readHostMessage)).toContainEqual(expect.objectContaining({ type: 'queue.state',
    rejected: { queueId: 'queue', text: 'Do real work later', reason: PREVIEW_NOTICE } }));
  h.runtime.postMessage({ type: 'models.request', version: MODEL_MANAGER_VERSION, requestId: 'read', action: { kind: 'refresh' } });
  h.runtime.postMessage({ type: 'management.request', version: MANAGEMENT_VERSION, requestId: 'settings', action: { kind: 'settings.read' } });
  await flush();
  const modelState = h.emitted().map(parseModelsHostMessage).find(message => message?.type === 'models.snapshot');
  expect(modelState).toMatchObject({ snapshot: { models: [expect.objectContaining({ test: null }), expect.anything()] } });
  expect(h.emitted().map(parseManagementHostMessage)).toContainEqual(expect.objectContaining({
    requestId: 'settings', settings: expect.objectContaining({ theme: 'dark' }),
  }));
  expect(h.notice).toHaveBeenCalledWith(PREVIEW_NOTICE);
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.acquire).not.toHaveBeenCalled();
  h.runtime.dispose();
});

it('opens local settings and review fixtures while denying arbitrary workspace reads', async () => {
  const h = setup();
  h.runtime.postMessage({ type: 'management.open', page: 'completion' });
  expect(h.navigate).toHaveBeenCalledWith('management', 'completion');
  h.runtime.postMessage({ type: 'management.request', version: MANAGEMENT_VERSION, requestId: 'ready', action: { kind: 'ready' } });
  h.runtime.postMessage({ type: 'reviewPanel.readFile', requestId: 'known', path: 'src/navigation.ts' });
  h.runtime.postMessage({ type: 'reviewPanel.readFile', requestId: 'unknown', path: 'private/settings.json' });
  h.runtime.postMessage({ type: 'reviewQuestion.models', sessionId: 'preview-review' });
  await flush();
  expect(h.emitted().map(parseManagementHostMessage)).toContainEqual(expect.objectContaining({ type: 'management.navigate', page: 'completion' }));
  const known = h.emitted().find(message => message.requestId === 'known');
  const unknown = h.emitted().find(message => message.requestId === 'unknown');
  expect(isReviewPanelFile(known)).toBe(true);
  expect(known.recordedOperations).toHaveLength(1);
  expect(unknown).toMatchObject({ error: PREVIEW_NOTICE, recordedOperations: [] });
  expect(h.emitted().map(parseReviewQuestionResponse)).toContainEqual(expect.objectContaining({
    type: 'reviewQuestion.models', status: 'ready',
  }));
  h.runtime.dispose(); h.receive.mockClear();
  h.runtime.postMessage({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION });
  await flush();
  expect(h.receive).not.toHaveBeenCalled();
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.acquire).not.toHaveBeenCalled();
});
