import { BRIDGE_PROTOCOL_VERSION } from '../../../shared/bridgeMessages';
import { MANAGEMENT_VERSION, parseManagementRequest, type ManagementPage } from '../../../shared/protocol/managementPageProtocol';
import { MODEL_MANAGER_VERSION, parseModelsRequest } from '../../../shared/protocol/modelManagerProtocol';
import { MODEL_SOURCE_VERSION } from '../../../shared/protocol/modelSourceProtocol';
import { parseClipboardWrite } from '../../../shared/protocol/clipboardProtocol';
import { isStrictRecord } from '../../../shared/validation/strictValidation';
import { getStudioScenario } from '../scenarios';
import { createModelsPreviewSnapshot } from '../modelsPreviewTransport';
import { createPanelPreview } from '../panelPreview';
import type { StudioConfig } from '../studioRuntime';
import { createMissionSetupPreview, previewSettings, reviewEntries, reviewScope } from './fixtures';
import { createReplyPlayback } from './replyPlayback';
import { createReviewPlayback } from './reviewPlayback';
import { MISSION_BRIDGE_PROTOCOL_VERSION, parseMissionWebviewMessage } from '../../../shared/protocol/missionProtocol';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../../shared/protocol/missionControlPanelProtocol';
import { parseMissionControlSetupWebviewMessage, type MissionControlSetupSnapshotMessage } from '../../../shared/protocol/missionControlSetupProtocol';

export const PREVIEW_NOTICE = 'Preview only: this action was not executed. No backend is connected.';
export const PREVIEW_VIEWS = ['chat', 'management', 'models', 'mission', 'viewer', 'review', 'btw'] as const;
export type PreviewView = typeof PREVIEW_VIEWS[number];
export function isPreviewView(value: unknown): value is PreviewView {
  return PREVIEW_VIEWS.some(view => view === value);
}

/** In-memory fixture port. There is deliberately no live transport or persisted Host identity. */
export function createPreviewRuntime(config: StudioConfig, callbacks: {
  notice(message: string): void;
  navigate(view: PreviewView, page?: ManagementPage): void;
}) {
  let persistedState: unknown = {};
  let sequence = 0;
  let disposed = false;
  let epoch = 0;
  let landingPage: ManagementPage = 'general';
  const listeners = new Set<(message: unknown) => void>();
  const messages = getStudioScenario(config.scenario).build(() => ++sequence);
  const snapshot = messages.find(message => message.type === 'host.snapshot')!;
  const panels = createPanelPreview(config);
  const models = createModelsPreviewSnapshot();
  const settings = previewSettings(config);
  let missionSetup: MissionControlSetupSnapshotMessage | null = null;
  const emit = (message: unknown, valid: () => boolean = () => true): void => {
    const current = epoch;
    queueMicrotask(() => {
      if (disposed || current !== epoch || !valid()) return;
      for (const listener of listeners) listener(message);
      window.dispatchEvent(new MessageEvent('message', { data: message }));
    });
  };
  const playback = createReplyPlayback(messages, () => ++sequence, emit);
  const reviewModels = settings.reviewQuestion.models.map(({ id, label }) => ({ id, label }));
  const preferredReviewModel = settings.reviewQuestion.modelId ?? settings.reviewQuestion.inheritedModelId;
  const reviewPlayback = createReviewPlayback(reviewModels,
    reviewModels.find(model => model.id === preferredReviewModel)?.id ?? reviewModels[0]?.id ?? null,
    config.scenario === 'failure', emit);
  const block = () => callbacks.notice(PREVIEW_NOTICE);
  const replay = () => {
    epoch++;
    persistedState = {};
    missionSetup = null;
    reviewPlayback.reset();
    playback.reset();
  };
  const postMessage = (value: unknown): void => {
    if (disposed || !isStrictRecord(value) || typeof value.type !== 'string') return;
    const request = value;
    if (reviewPlayback.handle(request)) return;
    if (playback.handle(request)) return;
    const management = parseManagementRequest(request);
    if (management) {
      const kind = management.action.kind;
      const result = { type: 'management.result', version: MANAGEMENT_VERSION, requestId: management.requestId };
      if (kind === 'ready' || kind === 'settings.read') {
        emit({ ...result, ok: true, settings });
        if (kind === 'ready') emit({ type: 'management.navigate', version: MANAGEMENT_VERSION, page: landingPage });
      } else if (kind === 'sessions.list') emit({ ...result, ok: true, sessions: [{
        id: 'preview-session', title: 'Example conversation', cwd: '/preview/workspace', kind: 'chat',
        modifiedTime: '2026-11-05T12:00:00.000Z', messageCount: snapshot.transcript.length,
        favorite: true, archived: false, currentFolder: true, active: false,
      }], nextCursor: null });
      else if (kind === 'missions.list') emit({ ...result, ok: true, missions: [] });
      else if (kind === 'automations.list') emit({ ...result, ok: true, automations: [] });
      else if (kind === 'account.read') emit({ ...result, ok: false,
        account: { status: 'unavailable', message: 'Offline preview · no account connected.' } });
      else if (kind === 'session.view') {
        emit({ ...result, ok: true, message: 'Opened the fixed example, not a saved session.' });
        callbacks.navigate('viewer');
      } else {
        block();
        emit({ ...result, ok: false, message: PREVIEW_NOTICE });
      }
      return;
    }
    const modelRequest = parseModelsRequest(request);
    if (modelRequest) {
      const read = modelRequest.action.kind === 'refresh';
      if (read) emit({ type: 'models.snapshot', version: MODEL_MANAGER_VERSION, snapshot: models });
      else block();
      emit({ type: 'models.result', version: MODEL_MANAGER_VERSION, requestId: modelRequest.requestId,
        ok: read, message: read ? 'Fixed example models. No provider was contacted.' : PREVIEW_NOTICE });
      return;
    }
    const missionRequest = parseMissionWebviewMessage(request);
    if (missionRequest?.type === 'mission.panel.open' || missionRequest?.type === 'mission.dismissSetup') {
      const setup = missionRequest.type === 'mission.panel.open' && missionRequest.target === 'setup';
      emit({ type: 'missionControl.route', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION, route: setup ? 'new-mission' : 'catalog' });
      if (setup) {
        missionSetup = createMissionSetupPreview(settings, ++sequence, missionRequest.task);
        emit(missionSetup);
        callbacks.notice('Offline Mission setup preview. Draft changes stay in this tab; Start Mission is not connected.');
      } else {
        missionSetup = null;
        if (missionRequest.type === 'mission.panel.open') callbacks.navigate('mission');
      }
      return;
    }
    const draftUpdate = parseMissionControlSetupWebviewMessage(request);
    if (draftUpdate?.type === 'missionControl.setup.update' && missionSetup) {
      if (draftUpdate.setupRevision === missionSetup.setupRevision &&
        draftUpdate.workspaceAuthorityRevision === missionSetup.workspaceAuthorityRevision &&
        draftUpdate.chatOwnerRevision === missionSetup.chatOwnerRevision) {
        missionSetup = { ...missionSetup, draft: draftUpdate.draft, setupRevision: missionSetup.setupRevision + 1, sequence: ++sequence };
      }
      emit(missionSetup);
      return;
    }
    if (missionRequest?.type === 'mission.start') {
      block();
      emit({ type: 'mission.controlResult', protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
        sequence: ++sequence, scope: 'selected-chat', requestId: missionRequest.requestId,
        action: 'start', status: 'rejected', rejectionCode: 'unavailable' });
      return;
    }
    switch (request.type) {
      case 'webview.ready':
        if (request.protocolVersion === BRIDGE_PROTOCOL_VERSION) replay();
        return;
      case 'webview.diagnostic':
      case 'webview.state-applied':
        return;
      case 'ui.locale.read':
        emit({ type: 'ui.locale', preference: 'en', resolved: 'en' });
        return;
      case 'ui.modelSource.read':
      case 'ui.modelSource.set':
        emit({ type: 'ui.modelSource.state', version: MODEL_SOURCE_VERSION,
          mode: request.type === 'ui.modelSource.set' ? request.mode : 'mixed' });
        if (request.type === 'ui.modelSource.set') callbacks.notice('Model filter changed locally for this preview only.');
        return;
      case 'ui.theme.set':
        block();
        emit({ type: 'ui.theme', preference: config.theme, resolved: config.theme === 'light' ? 'light' : 'dark' });
        return;
      case 'session.setting.update':
        block();
        emit({ type: 'session.settings', sequence: ++sequence, sessionId: snapshot.sessionId, settings: snapshot.settings });
        return;
      case 'management.open':
        landingPage = request.page as ManagementPage;
        callbacks.navigate('management', landingPage);
        return;
      case 'models.open':
        callbacks.navigate('models');
        return;
      case 'review.panel.open':
        callbacks.navigate('review');
        return;
      case 'sessionViewer.ready':
      case 'missionControl.ready':
      case 'missionControl.catalog.request':
        panels.postMessage(request);
        return;
      case 'reviewPanel.ready':
        emit({ type: 'reviewPanel.context', sessionId: reviewScope.sessionId, latestTurnId: reviewScope.turnId,
          valid: true, operation: null, operationPath: reviewScope.files[0]!.path, toolUseId: 'preview-edit' });
        emit({ type: 'review.state', sequence: ++sequence, state: reviewScope });
        return;
      case 'reviewPanel.readFile':
        emit({ type: 'reviewPanel.file', requestId: request.requestId, reviewScopeId: reviewScope.reviewScopeId,
          path: request.path, version: 'preview-v1', patch: '', truncated: false,
          error: request.path === reviewScope.files[0]!.path ? null : PREVIEW_NOTICE,
          recordedOperations: request.path === reviewScope.files[0]!.path ? reviewEntries : [] });
        return;
      case 'review.listBranches':
        emit({ type: 'review.branches', sequence: ++sequence, sessionId: reviewScope.sessionId,
          requestId: request.requestId, refs: [] });
        callbacks.notice('No Git repository is connected. Only the fixed recorded edit is available.');
        return;
      case 'review.open':
      case 'review.refresh':
        if (request.scopeKind === 'operations' || request.type === 'review.refresh') {
          emit({ type: 'review.state', sequence: ++sequence, state: reviewScope, requestId: request.requestId });
        } else {
          block();
          emit({ type: 'review.operationResult', sequence: ++sequence, sessionId: reviewScope.sessionId,
            reviewScopeId: reviewScope.reviewScopeId, requestId: request.requestId, operation: 'open',
            ok: false, message: PREVIEW_NOTICE });
        }
        return;
      case 'reviewPanel.openNative':
        block();
        emit({ type: 'reviewPanel.error', requestId: request.requestId, message: PREVIEW_NOTICE });
        return;
      case 'reviewPanel.gitStatus':
        emit({ type: 'git.status', sequence: ++sequence, sessionId: reviewScope.sessionId,
          turnId: reviewScope.turnId, branch: null, files: [], unavailableReason: 'no-repository' });
        return;
      case 'review.runAgentReview':
        block();
        emit({ type: 'review.agentReviewState', sequence: ++sequence, sessionId: reviewScope.sessionId,
          reviewScopeId: reviewScope.reviewScopeId, status: 'failed', message: PREVIEW_NOTICE });
        return;
      case 'codeReference.resolve':
        emit({ type: 'codeReference.result', requestId: request.requestId, reference: null });
        return;
      case 'clipboard.write': {
        const copy = parseClipboardWrite(request);
        if (!copy) return;
        if (!navigator.clipboard?.writeText) {
          block(); emit({ type: 'clipboard.result', requestId: copy.requestId, ok: false });
        } else void navigator.clipboard.writeText(copy.text).then(
          () => emit({ type: 'clipboard.result', requestId: copy.requestId, ok: true }),
          () => { block(); emit({ type: 'clipboard.result', requestId: copy.requestId, ok: false }); },
        );
        return;
      }
      default:
        block();
    }
  };
  return {
    getState: () => persistedState,
    setState: (state: unknown) => { persistedState = state; },
    postMessage, postManagement: postMessage, postModelSourceMessage: postMessage,
    subscribe(listener: (message: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    suspend() { epoch++; playback.cancel(); reviewPlayback.reset(); },
    dispose() { disposed = true; epoch++; playback.cancel(); reviewPlayback.reset(); listeners.clear(); },
    replay,
  };
}
