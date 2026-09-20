import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../shared/protocol/missionControlPanelProtocol';
import { MISSION_BRIDGE_PROTOCOL_VERSION, type MissionControlResultMessage, type MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import type { MissionControlSetupSnapshotMessage } from '../../shared/protocol/missionControlSetupProtocol';
import { LayoutList, MessageSquare, TriangleAlert, X } from 'lucide-react';
import { createMissionRequestId, describeReadinessWarning, describeSetupStatus, formatPhase, phaseTone } from '../../webview/missionControl/workspacePresentation';
import { MissionSetup } from './MissionSetup';
import { MissionDetails } from './MissionDetails';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';

export function MissionWorkspace({ route, setup, mission, result, vscode, onCatalog, onClose, onShowChat }: {
  readonly route: 'new-mission' | 'detail';
  readonly setup: MissionControlSetupSnapshotMessage | null;
  readonly mission: MissionSnapshotMessage | null;
  readonly result: MissionControlResultMessage | null;
  readonly vscode: { postMessage(message: unknown): void };
  readonly onCatalog: () => void;
  readonly onClose: () => void;
  readonly onShowChat: () => void;
}) {
  const starting = setup?.phase === 'starting';
  return <aside aria-label={route === 'new-mission' ? 'Mission setup' : 'Mission details'} data-webview-overlay=""
    className="v2-mission-workspace relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background text-[13px] leading-5">
    <header className="v2-mission-workspace-header space-y-3 border-b border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" className="-ml-2 h-8" disabled={route === 'new-mission' && starting} onClick={onCatalog}><LayoutList />All Missions</Button>
        <Button variant="ghost" className="h-8" disabled={route === 'new-mission' && starting} onClick={onClose}><X />{route === 'detail' ? 'Leave Mission' : 'Cancel setup'}</Button>
      </div>
      <div className="space-y-2">
        <h1 className="break-words text-base font-semibold">{route === 'new-mission' ? 'New Mission' : mission?.title ?? 'Mission'}</h1>
        {route === 'new-mission'
          ? <p className="text-xs text-muted-foreground">Review the brief and execution settings before starting.</p>
          : mission === null
            ? <p className="text-xs text-muted-foreground">Loading Mission state…</p>
            : <span className="v2-mission-pill" data-tone={phaseTone(mission)}><span aria-hidden="true" className="v2-mission-dot" />{formatPhase(mission)}</span>}
      </div>
      <Button variant="outline" className="v2-mission-chat-toggle h-8 w-full" onClick={onShowChat}><MessageSquare />Show chat{mission?.lifecycle === 'awaiting_input' ? ' · Input needed' : ''}</Button>
    </header>
    {route === 'new-mission' ? <>
        <p role="status" aria-live="polite" className="v2-mission-setup-status border-b border-border px-4 py-3 text-xs text-muted-foreground">{setup ? describeSetupStatus(setup) : 'Loading Mission setup…'}</p>
        {setup?.phase === 'advisory' && setup.readiness ? <section role="alert" data-tone="attention" className="v2-mission-banner mx-4 mt-4 space-y-3 p-4 text-xs">
          <h2 className="flex items-center gap-2 text-[13px] font-medium"><TriangleAlert aria-hidden="true" className="size-4" />Repository readiness warning</h2>
          <p>{describeReadinessWarning(setup.readiness.warning)}</p>
          <Button size="sm" variant="outline" onClick={() => vscode.postMessage({ type: 'missionControl.setup.continue', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
            requestId: createMissionRequestId('mission-continue'), setupRevision: setup.setupRevision })}>Continue anyway</Button>
        </section> : null}
    </> : null}
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
      {route === 'new-mission' ? <>
        {setup?.capabilities ? <MissionSetup capabilities={setup.capabilities} initialTask={setup.draft.task} onDismiss={onClose}
          result={result?.action === 'start' ? { requestId: result.requestId, status: result.status } : null}
          startDisabled={setup.availability !== 'ready' || (setup.phase !== 'draft' && setup.phase !== 'indeterminate')}
          onStart={(submission) => {
            if (setup.availability !== 'ready') return null;
            const id = createMissionRequestId('mission-start');
            vscode.postMessage({ type: 'mission.start', protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION, requestId: id, scope: 'selected-chat', ...submission });
            return id;
          }} />
          : setup === null ? <DroidLoading label="Loading Mission setup…" detail="Waiting for chat and model capabilities." />
            : <p className="v2-mission-empty text-xs text-muted-foreground">Mission setup is waiting for an available chat and model catalog.</p>}
      </> : mission === null ? <DroidLoading label="Loading Mission details…" /> : <MissionDetails mission={mission} result={result} vscode={vscode} />}
    </div>
  </aside>;
}
