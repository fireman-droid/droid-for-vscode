import { useState } from 'react';
import { MAX_MISSION_TASK_LENGTH, type MissionProfile, type MissionSetupCapabilities, type MissionReasoningEffort } from '../../shared/protocol/missionProtocol';
import { useMissionSetupFlow, type MissionSetupProps, type MissionPair } from '../../webview/assistant/mission/missionSetupFlow';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Switch } from '../ui/controls';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { MissionSelect } from './MissionSelect';
import { ChevronRight, Play, X } from 'lucide-react';

const effortLabel = (value: string) => value === 'xhigh' ? 'Extra high' : value.charAt(0).toUpperCase() + value.slice(1);

export function MissionSetup(props: MissionSetupProps) {
  const { capabilities, onDismiss, startDisabled } = props;
  const flow = useMissionSetupFlow(props);
  const [advanced, setAdvanced] = useState(false);
  return <section aria-label="Mission brief" className="@container space-y-6 text-[13px] leading-5">
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-2">
        <StepHeading step={1} title="Define the outcome" detail="Droid plans the work, coordinates Workers, and validates the result." />
        <Button variant="ghost" size="icon" aria-label="Dismiss Mission setup" disabled={flow.controlsDisabled} onClick={onDismiss}><X /></Button>
      </header>
      <label className="block space-y-2.5"><span className="font-medium">What should this Mission deliver?</span>
        <Textarea aria-label="Mission task" autoFocus rows={5} className="min-h-32 resize-none rounded-md p-4 leading-6" value={flow.task} maxLength={MAX_MISSION_TASK_LENGTH} disabled={flow.controlsDisabled}
          onChange={(event) => flow.setTask(event.target.value)} placeholder="For example: ship the new onboarding flow, including its empty states and error recovery." />
        <span className="flex justify-between gap-3 text-xs text-muted-foreground"><span>Describe the outcome and any constraints.</span><span className="shrink-0 tabular-nums">{flow.task.length.toLocaleString()} / {MAX_MISSION_TASK_LENGTH.toLocaleString()}</span></span>
      </label>
    </div>
    <section className="space-y-5 rounded-xl border border-border p-5">
      <StepHeading step={2} title="Orchestrator" detail="Owns the plan. These settings apply to the selected chat when the Mission starts." />
      <PairFields name="Orchestrator" pair={flow.orchestrator} capabilities={capabilities} disabled={flow.controlsDisabled} onChange={flow.setOrchestrator} />
    </section>
    <dl aria-label="Mission execution flow" className="grid gap-px overflow-hidden rounded-xl border border-border bg-border text-xs @min-[480px]:grid-cols-3 [&>div]:min-w-0 [&>div]:bg-background [&>div]:p-4 [&_dt]:mb-1.5 [&_dt]:text-muted-foreground [&_dd]:break-words [&_dd]:font-medium">
      <div><dt>Orchestrator</dt><dd title={`${capabilities.catalog.find((model) => model.id === flow.orchestrator.modelId)?.displayName ?? flow.orchestrator.modelId} · ${effortLabel(flow.orchestrator.reasoningEffort)}`}>{capabilities.catalog.find((model) => model.id === flow.orchestrator.modelId)?.displayName ?? flow.orchestrator.modelId} · {effortLabel(flow.orchestrator.reasoningEffort)}</dd></div>
      <div><dt>Worker</dt><dd>{flow.worker.mode === 'same-as-orchestrator' ? 'Inherits orchestrator' : `${capabilities.catalog.find((model) => model.id === flow.worker.modelId)?.displayName ?? flow.worker.modelId} · ${effortLabel(flow.worker.reasoningEffort)}`}</dd></div>
      <div><dt>Validation</dt><dd>{flow.enabledValidationCount} {flow.enabledValidationCount === 1 ? 'check' : 'checks'} enabled</dd></div>
    </dl>
    <Collapsible open={advanced} onOpenChange={setAdvanced} disabled={flow.controlsDisabled}>
    <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto w-full justify-between gap-3 rounded-xl border border-border p-4 text-left whitespace-normal" aria-label="Advanced Mission settings" disabled={flow.controlsDisabled}>
      <span className="flex items-start gap-2.5"><span aria-hidden="true" className="v2-mission-step mt-0.5">3</span><span><span className="block font-medium text-foreground">Execution settings</span><span className="mt-1 block text-xs font-normal text-muted-foreground">Worker, Validator, and quality checks</span></span></span><ChevronRight className={`mt-1 size-4 transition-transform motion-reduce:transition-none ${advanced ? 'rotate-90' : ''}`} />
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="grid grid-cols-1 gap-4 pt-4 @min-[560px]:grid-cols-2">
      <ProfileFields name="Worker" profile={flow.worker} capabilities={capabilities} disabled={flow.controlsDisabled} onChange={flow.setWorker} />
      <ProfileFields name="Validator" profile={flow.validator} capabilities={capabilities} disabled={flow.controlsDisabled} onChange={flow.setValidator} />
      <fieldset className="col-span-full min-w-0 rounded-lg border border-border p-5"><legend className="px-1 font-medium">Validation checks</legend>
        <p className="mb-3 text-xs text-muted-foreground">Both checks use the shared Validator profile configured above.</p>
        <MissionToggle label="Run Scrutiny" description="Review the completed feature for implementation risks." checked={flow.scrutinyEnabled} disabled={flow.controlsDisabled} onChange={flow.setScrutinyEnabled} />
        <MissionToggle label="Run User Testing" description="Validate the finished flow through its user-facing surface." checked={flow.userTestingEnabled} disabled={flow.controlsDisabled} onChange={flow.setUserTestingEnabled} />
      </fieldset>
    </CollapsibleContent></Collapsible>
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
      <p role="status" aria-live="polite" aria-label="Mission setup status" className={`min-w-40 flex-1 text-xs ${flow.visibleErrors.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{flow.status}</p>
      <Button className="h-9 min-w-32 rounded-md" disabled={flow.pending || startDisabled || flow.validation.errors.length > 0} onClick={flow.submit}><Play />{flow.pending ? 'Starting…' : 'Start Mission'}</Button>
    </div>
  </section>;
}

function StepHeading({ step, title, detail }: { readonly step: number; readonly title: string; readonly detail: string }) {
  return <div className="flex items-start gap-2.5">
    <span aria-hidden="true" className="v2-mission-step mt-0.5">{step}</span>
    <div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
  </div>;
}

function PairFields({ name, pair, capabilities, disabled, onChange }: {
  readonly name: string; readonly pair: MissionPair; readonly capabilities: MissionSetupCapabilities;
  readonly disabled: boolean; readonly onChange: (value: MissionPair) => void;
}) {
  const efforts = capabilities.catalog.find((model) => model.id === pair.modelId)?.supportedReasoningEfforts ?? [];
  return <div className="mission-pair grid min-w-0 grid-cols-1 gap-3 @min-[400px]:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
    <MissionSelect label={`${name} model`} value={pair.modelId} options={capabilities.catalog.map((model) => ({ value: model.id, label: model.displayName }))}
      disabled={disabled} onChange={(modelId) => onChange({ ...pair, modelId })} placeholder="Choose an available model" />
    <MissionSelect label={`${name} reasoning`} value={efforts.includes(pair.reasoningEffort) ? pair.reasoningEffort : ''}
      options={efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))} disabled={disabled}
      onChange={(value) => onChange({ ...pair, reasoningEffort: value as MissionReasoningEffort })} placeholder="Choose available reasoning" />
  </div>;
}

function ProfileFields({ name, profile, capabilities, disabled, onChange }: {
  readonly name: 'Worker' | 'Validator'; readonly profile: MissionProfile; readonly capabilities: MissionSetupCapabilities;
  readonly disabled: boolean; readonly onChange: (value: MissionProfile) => void;
}) {
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-5 [&_.mission-pair]:grid-cols-1"><legend className="px-1 font-medium">{name}</legend>
    <p className="text-xs text-muted-foreground">{name === 'Worker' ? 'Executes one feature at a time under the Orchestrator.' : 'Provides the shared profile for all quality checks.'}</p>
    <MissionSelect label={`${name} inheritance`} fieldLabel="Configuration" value={profile.mode} disabled={disabled}
      options={[{ value: 'same-as-orchestrator', label: 'Same as orchestrator' }, { value: 'override', label: 'Choose independently' }]}
      onChange={(value) => onChange(value === 'same-as-orchestrator' ? { mode: value, ...capabilities.currentChat } : { ...profile, mode: 'override' })} />
    {profile.mode === 'override' ? <PairFields name={name} pair={profile} capabilities={capabilities} disabled={disabled} onChange={(pair) => onChange({ ...profile, ...pair })} /> : null}
  </fieldset>;
}

function MissionToggle({ label, description, checked, disabled, onChange }: {
  readonly label: string; readonly description: string; readonly checked: boolean;
  readonly disabled: boolean; readonly onChange: (value: boolean) => void;
}) {
  return <label className="relative flex cursor-pointer items-center gap-3 border-t border-border py-3.5">
    <span className={`min-w-0 flex-1 ${disabled ? 'opacity-50' : ''}`}><strong className="block font-medium">{label}</strong><small className="mt-1 block text-xs text-muted-foreground">{description}</small></span>
    <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </label>;
}
