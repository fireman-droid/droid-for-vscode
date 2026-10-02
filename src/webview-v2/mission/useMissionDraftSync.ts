import { useEffect, useRef, useState } from 'react';
import type { MissionControlSetupDraft, MissionControlSetupSnapshotMessage } from '../../shared/protocol/missionControlSetupProtocol';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../shared/protocol/missionControlPanelProtocol';
import { createMissionRequestId } from './workspacePresentation';

/** Retain selections in the Host when setup is hidden, remounted, or reloaded. */
export function useMissionDraftSync(
  setup: MissionControlSetupSnapshotMessage | null,
  vscode: { postMessage(message: unknown): void },
) {
  const [draft, setDraft] = useState<MissionControlSetupDraft | null>(null);
  const lastPosted = useRef('');
  useEffect(() => {
    if (!setup || !draft || (setup.phase !== 'draft' && setup.phase !== 'indeterminate')) return;
    const key = JSON.stringify(draft);
    if (key === JSON.stringify(setup.draft)) return;
    const attempt = `${setup.sequence}:${key}`;
    if (attempt === lastPosted.current) return;
    lastPosted.current = attempt;
    // A stale revision receives a fresh Host snapshot. Retry only the latest
    // local draft against that revision, so quick consecutive selections stick.
    vscode.postMessage({ type: 'missionControl.setup.update', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: createMissionRequestId('mission-draft'), setupRevision: setup.setupRevision,
      workspaceAuthorityRevision: setup.workspaceAuthorityRevision, chatOwnerRevision: setup.chatOwnerRevision, draft });
  }, [setup, draft, vscode]);
  return setDraft;
}
