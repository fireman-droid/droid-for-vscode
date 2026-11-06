import { useI18n } from '@droidvisx/chat-ui/i18n';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../shared/protocol/missionControlPanelProtocol';
import { MISSION_BRIDGE_PROTOCOL_VERSION, type MissionControlResultMessage, type MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import type { MissionControlSetupSnapshotMessage } from '../../shared/protocol/missionControlSetupProtocol';
import { LayoutList, MessageSquare, TriangleAlert, X } from 'lucide-react';
import { createMissionRequestId, describeReadinessWarning, describeSetupStatus, formatPhase, phaseTone } from './workspacePresentation';
import { MissionSetup } from './MissionSetup';
import { useMissionDraftSync } from './useMissionDraftSync';
import { MissionDetails } from './MissionDetails';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';

export function MissionWorkspace({ route, setup, mission, result, inputNeeded, vscode, onCatalog, onClose, onShowChat }: {
  readonly route: 'new-mission' | 'detail';
  readonly setup: MissionControlSetupSnapshotMessage | null;
  readonly mission: MissionSnapshotMessage | null;
  readonly result: MissionControlResultMessage | null;
  readonly inputNeeded: boolean;
  readonly vscode: { postMessage(message: unknown): void };
  readonly onCatalog: () => void;
  readonly onClose: () => void;
  readonly onShowChat: () => void;
}) {
  const { t } = useI18n();
  const starting = setup?.phase === 'starting';
  const onDraftChange = useMissionDraftSync(setup, vscode);
  const configuring = route === 'new-mission';
  const readinessNotice = setup?.phase === 'advisory' && setup.readiness ? <section role="alert" data-ui-notice="" data-tone="attention" className="v2-mission-banner space-y-2 p-3 text-xs">
    <h2 className="flex items-center gap-2 text-[13px] font-medium"><TriangleAlert aria-hidden="true" className="size-4" />{t("Repository readiness warning")}</h2>
    <p>{describeReadinessWarning(setup.readiness.warning)}</p>
    <Button size="sm" variant="outline" onClick={() => vscode.postMessage({ type: 'missionControl.setup.continue', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: createMissionRequestId('mission-continue'), setupRevision: setup.setupRevision })}>{t("Continue anyway")}</Button>
  </section> : null;
  const body = configuring ? <>
        {setup?.capabilities ? <MissionSetup capabilities={setup.capabilities} initialTask={setup.draft.task} initialDraft={setup.draft} onDraftChange={onDraftChange} onDismiss={onClose}
          startHint={t(describeSetupStatus(setup))} notice={readinessNotice}
          result={result?.action === 'start' ? result : null}
          startDisabled={setup.availability !== 'ready' || (setup.phase !== 'draft' && setup.phase !== 'indeterminate')}
          onStart={(submission) => {
            if (setup.availability !== 'ready') return null;
            const id = createMissionRequestId('mission-start');
            vscode.postMessage({ type: 'mission.start', protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION, requestId: id, scope: 'selected-chat', ...submission });
            return id;
          }} />
          : <div className="space-y-4">{readinessNotice}{setup === null || setup.availability === 'loading'
            ? <DroidLoading label={t("Loading Mission setup…")} detail={t("Waiting for chat and model capabilities.")} />
            : <p role="status" data-ui-notice="" className="text-xs text-muted-foreground">{t(describeSetupStatus(setup))}</p>}</div>}
      </> : mission === null ? <DroidLoading label={t("Loading Mission details…")} /> : <MissionDetails mission={mission} result={result} inputNeeded={inputNeeded} vscode={vscode} />;
  return <aside aria-label={configuring ? t("Mission setup") : t("Mission details")} data-webview-overlay=""
    data-route={route}
    className="v2-mission-workspace relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background text-[13px] leading-5">
    <header className="v2-mission-workspace-header shrink-0 space-y-2 border-b border-border p-3">
      <div className="flex items-start gap-2">
        <h1 data-ui-notice={configuring ? '' : undefined} className="min-w-0 flex-1 break-words pt-0.5 text-[13px] font-semibold">{configuring ? t("New Mission") : mission?.title ?? t("Mission")}</h1>
        <Button variant="plain" size="icon-sm" aria-label={t("All Missions")} title={t("All Missions")} disabled={configuring && starting} onClick={onCatalog}><LayoutList /></Button>
        {configuring && setup?.capabilities ? <Button variant="plain" size="icon-sm" className="v2-mission-chat-toggle" aria-label={t("Show chat")} title={t("Show chat")} onClick={onShowChat}><MessageSquare /></Button>
          : <Button variant="plain" size="icon-sm" aria-label={configuring ? t("Cancel setup") : t("Leave Mission")} title={configuring ? t("Cancel setup") : t("Leave Mission")} disabled={configuring && starting} onClick={onClose}><X /></Button>}
      </div>
      {configuring
        ? <p data-ui-notice="" className="text-xs text-muted-foreground">{t("Set a goal. Droid plans, builds, and checks the result.")}</p>
        : mission === null
          ? <p data-ui-notice="" className="text-xs text-muted-foreground">{t("Loading Mission state…")}</p>
          : <span data-ui-notice="" className="v2-mission-pill" data-tone={phaseTone(mission)}><span aria-hidden="true" className="v2-mission-dot" />{formatPhase(mission)}</span>}
      {!configuring || !setup?.capabilities ? <Button variant="outline" size="sm" className="v2-mission-chat-toggle" onClick={onShowChat}><MessageSquare />{t("Show chat")}{inputNeeded ? t("· Input needed") : ''}</Button> : null}
    </header>
    {configuring && setup?.capabilities ? body : <ScrollArea className="min-h-0 flex-1" viewportClassName="overscroll-contain"><div className="p-3">{body}</div></ScrollArea>}
  </aside>;
}
