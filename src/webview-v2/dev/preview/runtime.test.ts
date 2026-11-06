// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION } from '../../../shared/bridgeMessages';
import { MANAGEMENT_VERSION, parseManagementHostMessage } from '../../../shared/protocol/managementPageProtocol';
import { MODEL_MANAGER_VERSION, parseModelsHostMessage } from '../../../shared/protocol/modelManagerProtocol';
import { isReviewPanelFile } from '../../../shared/protocol/reviewPanelProtocol';
import { parseReviewQuestionResponse } from '../../../shared/protocol/reviewQuestionProtocol';
import { readHostMessage } from '../../bridge/validateHostMessage';
import { createPreviewRuntime, PREVIEW_NOTICE } from './runtime';
import { MISSION_BRIDGE_PROTOCOL_VERSION } from '../../../shared/protocol/missionProtocol';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION, parseMissionControlPanelHostMessage } from '../../../shared/protocol/missionControlPanelProtocol';

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

it('opens the chat Mission setup, keeps draft edits local and rejects starting a real Mission', async () => {
  const h = setup();
  const envelope = { protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION, scope: 'selected-chat' };
  h.runtime.postMessage({ ...envelope, type: 'mission.panel.open', requestId: 'open', target: 'setup', task: 'Preview task' });
  await flush();
  const initial = h.emitted().find(message => message.type === 'missionControl.setup.snapshot');
  expect(h.emitted().map(parseMissionControlPanelHostMessage)).toContainEqual(expect.objectContaining({ type: 'missionControl.route', route: 'new-mission' }));
  expect(parseMissionControlPanelHostMessage(initial)).toMatchObject({ type: 'missionControl.setup.snapshot', draft: { task: 'Preview task' } });
  h.runtime.postMessage({ type: 'missionControl.setup.update', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId: 'draft', setupRevision: initial.setupRevision, workspaceAuthorityRevision: initial.workspaceAuthorityRevision,
    chatOwnerRevision: initial.chatOwnerRevision, draft: { ...initial.draft, task: 'Edited preview task' } });
  await flush();
  const updated = h.emitted().at(-1);
  expect(parseMissionControlPanelHostMessage(updated)).toMatchObject({ type: 'missionControl.setup.snapshot', draft: { task: 'Edited preview task' } });
  h.runtime.postMessage({ ...envelope, type: 'mission.start', requestId: 'start', ...updated.draft });
  await flush();
  expect(h.emitted().map(readHostMessage)).toContainEqual(expect.objectContaining({
    type: 'mission.controlResult', requestId: 'start', status: 'rejected', action: 'start', rejectionCode: 'unavailable',
  }));
  expect(h.notice).toHaveBeenCalledWith(PREVIEW_NOTICE);
  h.runtime.postMessage({ ...envelope, type: 'mission.dismissSetup', requestId: 'close', snapshotRevision: 0 });
  await flush();
  expect(parseMissionControlPanelHostMessage(h.emitted().at(-1))).toMatchObject({ type: 'missionControl.route', route: 'catalog' });
  expect(h.emitted().some(message => message.type === 'mission.snapshot' || message.status === 'accepted')).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.acquire).not.toHaveBeenCalled();
  h.runtime.dispose();
});

it('boots validated production state and replays child activity after subscription without live access', async () => {
  const h = setup();
  h.runtime.postMessage({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION, pageId: 'preview' });
  await flush();
  const snapshot = h.emitted().find(message => message.type === 'host.snapshot');
  expect(readHostMessage(snapshot)).toMatchObject({ type: 'host.snapshot', sessionId: 'studio-session' });
  expect(snapshot.transcript.some((item: { kind: string }) => item.kind === 'tool')).toBe(true);
  h.receive.mockClear();
  h.runtime.postMessage({ type: 'subagent.panel', sessionId: 'studio-session', open: true });
  await flush();
  expect(h.emitted().map(readHostMessage)).toContainEqual(expect.objectContaining({ type: 'subagent.activity' }));
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.acquire).not.toHaveBeenCalled();
  h.runtime.dispose();
});

it('rejects model verification and saved settings with correlated results and no changes', async () => {
  const h = setup();
  h.runtime.postMessage({ type: 'models.request', version: MODEL_MANAGER_VERSION, requestId: 'verify',
    action: { kind: 'verifyModel', rawIndex: 0, expectedModel: 'gateway-reasoner', connectionId: 'gateway' } });
  h.runtime.postMessage({ type: 'management.request', version: MANAGEMENT_VERSION, requestId: 'save',
    action: { kind: 'theme.set', theme: 'light' } });
  await flush();
  expect(h.emitted().map(parseModelsHostMessage)).toContainEqual(expect.objectContaining({ requestId: 'verify', ok: false }));
  expect(h.emitted().map(parseManagementHostMessage)).toContainEqual(expect.objectContaining({ requestId: 'save', ok: false }));
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
