import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION, type MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import { SESSION_VIEWER_PROTOCOL_VERSION, type SessionViewerSnapshotMessage } from '../../shared/protocol/sessionViewerProtocol';
import { getStudioScenario } from './scenarios';
import type { StudioConfig } from './studioRuntime';

export function createPanelPreview(config: StudioConfig) {
  const posted: unknown[] = [];
  const emit = (message: unknown) => window.dispatchEvent(new MessageEvent('message', { data: message }));
  const preview = { posted, emit };
  (window as Window & { __dvxPanelPreview?: typeof preview }).__dvxPanelPreview = preview;
  const rows: MissionControlCatalogRow[] = [
    { catalogId: 'mission-preview-running', title: 'Ship the workspace navigation and review workflow', lifecycle: 'running',
      workspaceLabel: 'Preview workspace', computerLabel: 'Local preview', progress: { completed: 2, total: 5 },
      createdAt: null, updatedAt: null, elapsedMs: 90000, attached: true },
    { catalogId: 'mission-preview-completed', title: 'Complete the model configuration panel', lifecycle: 'completed',
      workspaceLabel: 'Preview workspace', computerLabel: 'Local preview', progress: { completed: 3, total: 3 },
      createdAt: null, updatedAt: null, elapsedMs: 120000, attached: false },
  ];
  let sequence = 0;
  const scenario = getStudioScenario(config.scenario).build(() => sequence++);
  const snapshot = scenario.find((message) => message.type === 'host.snapshot');
  const viewer: SessionViewerSnapshotMessage = {
    type: 'sessionViewer.snapshot', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    status: 'ready', target: { kind: 'daemon-session', mode: 'standard', sessionId: 'preview-viewer', title: 'Session activity · simulated preview' },
    items: snapshot?.transcript ?? [], truncated: false, running: false, lifecycle: 'completed', stopping: false, stopError: false,
  };
  return {
    postMessage(message: unknown) {
      posted.push(message);
      const request = message as { type: string; requestId?: string; filter?: string };
      if (request.type === 'sessionViewer.ready') queueMicrotask(() => emit(viewer));
      if (request.type === 'missionControl.ready' || request.type === 'missionControl.catalog.request') queueMicrotask(() => emit({
        type: 'missionControl.catalog.result', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        requestId: request.requestId ?? 'preview-initial', sequence: ++sequence, revision: 1,
        status: 'ready', filter: request.filter ?? 'all',
        rows: !request.filter || request.filter === 'all' ? rows : rows.filter((row) => row.lifecycle === request.filter),
      }));
    },
  };
}
