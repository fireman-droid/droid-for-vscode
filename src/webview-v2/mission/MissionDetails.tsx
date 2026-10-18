import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { Check, ChevronRight, Circle, CircleDot, CircleHelp, ExternalLink, Pause, Play, RefreshCw, ShieldCheck, Square, Unplug, UserCheck, X } from 'lucide-react';
import type { MissionControlResultMessage, MissionFeatureSnapshot, MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import { useMissionControl, type MissionUiCommand } from './useMissionControl';
import { createMissionRequestId, featureTone, formatFeatureStatus, formatPhase, phaseTone } from './workspacePresentation';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';

const requestId = () => createMissionRequestId('mission-control');
const rejectionCopy = {
  busy: 'Droid is handling another action. Wait for it to finish, then retry.',
  stale: 'Mission state changed before this action ran. Refresh the state and try again.',
  unavailable: 'This action is no longer available. Refresh the Mission state.',
  invalid: 'Droid could not apply this action to the selected Mission.',
};

export function MissionDetails({ mission, result, inputNeeded, vscode }: {
  readonly mission: MissionSnapshotMessage;
  readonly result: MissionControlResultMessage | null;
  readonly inputNeeded: boolean;
  readonly vscode: { postMessage(message: unknown): void };
}) {
  const { t } = useI18n();
  const command = useMissionControl(vscode, requestId);
  const [request, setRequest] = useState<{ id: string; status: 'pending' | 'accepted' | 'rejected'; text: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState<number | null>(null);
  useEffect(() => {
    if (result === null) return;
    setRequest((current) => current?.id === result.requestId ? {
      id: current.id, status: result.status,
      text: result.status === 'accepted' ? 'Request accepted. Progress below reflects the latest Droid state.'
        : rejectionCopy[result.rejectionCode ?? 'unavailable'],
    } : current);
  }, [result]);
  const send = (action: MissionUiCommand) => {
    setRequest({ id: command(action), status: 'pending', text: 'Sending request to Droid…' });
  };
  const busy = mission.controls.busyAction !== undefined || request?.status === 'pending';
  const total = mission.features.length;
  const completed = mission.completedFeatureCount;
  const current = mission.features.find((feature) => feature.id === mission.currentFeatureId);
  const tone = phaseTone(mission);
  return <div className="space-y-5 text-[13px] leading-5">
    <section aria-label={t("Mission progress")} className="v2-mission-panel space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="v2-mission-pill" data-tone={tone}><span aria-hidden="true" className="v2-mission-dot" />{t(formatPhase(mission))}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{completed} / {total} {t("features")}</span>
      </div>
      <Progress aria-label={t("Completed Mission features")} value={completed} max={Math.max(1, total)} aria-valuetext={total === 0 ? t('Waiting for a feature plan') : t('{completed} of {total} features completed', { completed, total })} />
      {current ? <p className="break-words text-xs text-muted-foreground">{t("Current feature")} <span className="font-medium text-foreground">{current.title}</span></p> : null}
      {mission.availability === 'detached' ? <p role="status" className="v2-mission-feedback flex items-start gap-2 rounded-md border border-border p-2.5 text-xs text-muted-foreground"><Unplug aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{t("This Mission is detached from the current runtime. Live controls are unavailable.")}</p> : null}
      {inputNeeded ? <p role="status" data-tone="attention" className="v2-mission-banner flex items-start gap-2 p-2.5 text-xs"><CircleHelp aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{t("Droid needs your input. Review the pending question or approval in the Mission chat.")}</p> : null}
    </section>
    <div aria-label={t("Mission controls")} className="flex flex-wrap gap-2">
      {mission.controls.canResume ? <Button className="h-8" disabled={busy} onClick={() => send({ type: 'mission.resume', revision: mission.revision })}><Play />{t("Resume Mission")}</Button> : null}
      {mission.controls.canPause ? <Button className="h-8" variant="outline" disabled={busy} onClick={() => send({ type: 'mission.pause', revision: mission.revision })}><Pause />{t("Pause activity")}</Button> : null}
      {mission.controls.canStopCurrentFeature ? <Button className="h-8" variant="destructive" disabled={busy} onClick={() => setConfirmStop(mission.revision)}><Square />{t("Stop feature")}</Button> : null}
      <Button className="ml-auto h-8" variant="ghost" disabled={busy} onClick={() => send({ type: 'mission.refresh', revision: mission.revision })}><RefreshCw />{t("Refresh")}</Button>
    </div>
    {request ? <p role={request.status === 'rejected' ? 'alert' : 'status'} aria-live="polite" className={`v2-mission-feedback rounded-md border p-3 text-xs ${request.status === 'rejected' ? 'border-destructive/30 text-destructive' : 'border-border text-muted-foreground'}`}>{t(request.text)}</p>
      : mission.controls.busyAction ? <p role="status" className="text-xs text-muted-foreground">{t("Updating Mission…")}</p> : null}
    <Tabs defaultValue="features">
      <TabsList aria-label={t("Mission details")} className="mb-4"><TabsTrigger value="features">{t("Features (")}{total})</TabsTrigger><TabsTrigger value="validation">{t("Validation")}</TabsTrigger></TabsList>
      <TabsContent value="features" className="outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {total === 0 ? <p data-ui-notice="" className="v2-mission-empty rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">{t("Droid has not published the feature plan yet. Planning and clarification happen in chat.")}</p> : null}
        <ol className="space-y-2">{mission.features.map((feature) => <FeatureRow key={feature.id} feature={feature} current={feature.id === mission.currentFeatureId}
          onView={() => send({ type: 'mission.viewer.open', revision: mission.revision, featureId: feature.id })} />)}</ol>
      </TabsContent>
      <TabsContent value="validation" className="space-y-3 outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <p className="text-xs text-muted-foreground">{t("Configured checks for this Mission. Enabled checks are not evidence that validation has passed.")}</p>
        <dl className="v2-mission-validation divide-y divide-border rounded-lg border border-border px-4">
          <div className="flex items-center justify-between gap-3 py-3">
            <dt className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />{t("Scrutiny")}</dt>
            <dd><span className="v2-mission-pill" data-tone={mission.validator.scrutinyEnabled ? 'active' : 'muted'}>{mission.validator.scrutinyEnabled ? t("Enabled") : t("Disabled")}</span></dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-3">
            <dt className="flex items-center gap-2"><UserCheck aria-hidden="true" className="size-4 text-muted-foreground" />{t("User Testing")}</dt>
            <dd><span className="v2-mission-pill" data-tone={mission.validator.userTestingEnabled ? 'active' : 'muted'}>{mission.validator.userTestingEnabled ? t("Enabled") : t("Disabled")}</span></dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t("Open a feature's Worker transcript to inspect the work and any reported checks.")}</p>
      </TabsContent>
    </Tabs>
    <Dialog open={confirmStop !== null} onOpenChange={(open) => { if (!open) setConfirmStop(null); }}><DialogContent className="v2-mission-dialog">
      <DialogTitle className="pr-8 text-sm font-semibold">{t("Stop the current feature?")}</DialogTitle>
      <DialogDescription className="mt-3 text-xs text-muted-foreground">{t("This interrupts the active Worker. Completed edits are not rolled back. The action applies only if the Mission state is still current.")}</DialogDescription>
      {confirmStop !== null && confirmStop !== mission.revision ? <p role="status" className="mt-3 text-xs text-muted-foreground">{t("Mission state changed. Close this dialog and review the current feature before retrying.")}</p> : null}
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmStop(null)}>{t("Cancel")}</Button>
        <Button variant="destructive" disabled={busy || !mission.controls.canStopCurrentFeature || confirmStop !== mission.revision} onClick={() => { if (confirmStop === null) return; send({ type: 'mission.stopCurrentFeature', revision: confirmStop }); setConfirmStop(null); }}>{t("Stop feature")}</Button></div>
    </DialogContent></Dialog>
  </div>;
}

function FeatureRow({ feature, current, onView }: {
  readonly feature: MissionFeatureSnapshot; readonly current: boolean; readonly onView: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const StatusIcon = feature.status === 'completed' ? Check : feature.status === 'in_progress' ? CircleDot : feature.status === 'cancelled' ? X : Circle;
  return <li className="v2-mission-feature min-w-0 rounded-lg border border-border" data-current={current || undefined}>
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-mission-feature-trigger flex w-full min-w-0 items-start gap-2.5 p-3 text-left">
        <span aria-hidden="true" className="v2-mission-node mt-0.5" data-tone={featureTone(feature.status)}><StatusIcon className="size-3.5" /></span>
        <span className="min-w-0 flex-1"><span className={`${open ? 'block' : 'line-clamp-2'} break-words font-medium`}>{feature.title}</span><span className="mt-1.5 block text-xs text-muted-foreground">{feature.order + 1} · {t(formatFeatureStatus(feature.status))}{current ? t("· Current") : ''}</span></span>
        <ChevronRight aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
      </Button></CollapsibleTrigger>
      <CollapsibleContent className="v2-mission-feature-content space-y-2 px-3 pb-3 pl-9">
        {feature.description && feature.description !== feature.title ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{feature.description}</p> : null}
        {feature.milestone ? <p className="break-words text-xs text-muted-foreground">{feature.milestone}</p> : null}
      </CollapsibleContent>
    </Collapsible>
    {feature.workerViewAvailable ? <div className="px-3 pb-3 pl-9"><Button variant="ghost" size="sm" onClick={onView}><ExternalLink />{t("Open worker chat")}</Button></div> : null}
  </li>;
}
