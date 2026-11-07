import type { SubagentInspectMessage, SubagentSnapshotMessage } from '../../../shared/protocol/subagentInspectionProtocol';
import { MAX_SESSION_VIEWER_TITLE_LENGTH } from '../../../shared/protocol/sessionViewerProtocol';
import type { SubagentPanelPort } from './subagentPanelPort';

interface Inspection {
  unsubscribe: (() => void) | null;
}
// Keyed by lifecycle identity so session binding can release the subscription immediately.
const inspections = new WeakMap<object, Inspection>();

export function cancelSubagentInspection(sessionState: object): void {
  const previous = inspections.get(sessionState);
  inspections.delete(sessionState);
  previous?.unsubscribe?.();
}

export function inspectSubagent(
  ctl: SubagentPanelPort,
  request: SubagentInspectMessage,
  ensureMapping: () => Promise<void>,
): void {
  const { sessionId, turnId, toolUseId } = request;
  if (ctl.sessionState.disposed || ctl.sessionState.sessionId !== sessionId) return;
  cancelSubagentInspection(ctl.sessionState);
  if (toolUseId === null) return;
  const slot: Inspection = { unsubscribe: null };
  inspections.set(ctl.sessionState, slot);
  const current = () => inspections.get(ctl.sessionState) === slot
    && !ctl.sessionState.disposed && ctl.sessionState.sessionId === sessionId;
  const row = ctl.recoveryState.transcript.transcript.find(item =>
    item.kind === 'tool' && item.turnId === turnId && item.toolUseId === toolUseId && item.subagent);
  const title = (row?.kind === 'tool' ? row.subagent?.description : undefined)
    ?.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, MAX_SESSION_VIEWER_TITLE_LENGTH).trim() || 'Subagent';
  const report = (value: Pick<SubagentSnapshotMessage, 'status' | 'items' | 'truncated' | 'running' | 'lifecycle' | 'reason'>) => {
    if (current()) ctl.emit({ type: 'subagent.snapshot', sessionId, turnId, toolUseId, title, ...value });
  };
  const unavailable = (reason: string) => report({
    status: 'unavailable', reason, items: [], truncated: false, running: false, lifecycle: null,
  });
  if (!row) { unavailable('This Task does not belong to the selected conversation and turn.'); return; }
  report({ status: 'loading', items: [], truncated: false, running: false, lifecycle: null });
  void ensureMapping().then(() => {
    if (!current()) return;
    const service = ctl.subagentState.subagentTranscripts;
    const resolved = service?.resolveSession(sessionId, turnId, toolUseId);
    if (!service || !resolved) { unavailable('The child conversation is not available for this Task.'); return; }
    const publish = () => {
      if (!current()) return;
      if (service.resolveSession(sessionId, turnId, toolUseId)?.sessionId !== resolved.sessionId) {
        unavailable('The child conversation no longer matches this Task.');
        cancelSubagentInspection(ctl.sessionState);
        return;
      }
      const snapshot = service.readViewer(resolved.sessionId, { parentSessionId: sessionId, toolUseId });
      if (snapshot) report({ status: 'ready', ...snapshot });
      else unavailable('The child conversation transcript is not available.');
    };
    slot.unsubscribe = service.subscribeViewer(resolved.sessionId, publish);
    publish();
  }).catch(() => {
    unavailable('The child conversation could not be read.');
    if (current()) cancelSubagentInspection(ctl.sessionState);
  });
}
