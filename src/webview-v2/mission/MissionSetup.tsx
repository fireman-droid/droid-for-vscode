import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_MISSION_TASK_LENGTH, type MissionProfile, type MissionSetupCapabilities, type MissionReasoningEffort } from '../../shared/protocol/missionProtocol';
import { useMissionSetupFlow, type MissionSetupProps, type MissionPair } from './missionSetupFlow';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Switch } from '../ui/controls';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { MissionSelect } from './MissionSelect';
import { ModelSourceSelect } from '../models/ModelSourceSelect';
import { ChevronDown, LoaderCircle, Network, Play, SlidersHorizontal, Target } from 'lucide-react';

const effortLabel = (value: string) => value === 'xhigh' ? 'Extra high' : value.charAt(0).toUpperCase() + value.slice(1);

export function MissionSetup(props: MissionSetupProps & { readonly startHint?: string; readonly notice?: ReactNode }) {
  const { capabilities, onDismiss, startDisabled, startHint, notice } = props;
  const flow = useMissionSetupFlow(props);
  const [advanced, setAdvanced] = useState(false);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { taskInput.current?.focus({ preventScroll: true }); }, []);
  const inheritedProfiles = flow.worker.mode === 'same-as-orchestrator' && flow.validator.mode === 'same-as-orchestrator';
  return <section aria-label="Mission brief" className="v2-mission-setup @container">
    <div className="v2-mission-setup-body">
      {notice}
      <section className="v2-mission-setup-section">
        <SectionHeading icon={<Target />} title="Mission goal" detail="What should be delivered? Include any constraints." />
        <Textarea ref={taskInput} aria-label="Mission task" rows={4} className="v2-mission-task" value={flow.task} maxLength={MAX_MISSION_TASK_LENGTH} disabled={flow.controlsDisabled}
          onChange={(event) => flow.setTask(event.target.value)} placeholder="For example: build the onboarding flow, with empty states and error recovery." />
        <p className="v2-mission-task-meta"><span>A clear outcome helps Droid plan the work.</span><span>{flow.task.length.toLocaleString()} / {MAX_MISSION_TASK_LENGTH.toLocaleString()}</span></p>
      </section>
      <section className="v2-mission-setup-section v2-mission-orchestrator">
        <SectionHeading icon={<Network />} title="Orchestrator" detail="Plans the work and coordinates Workers." />
        <PairFields name="Orchestrator" pair={flow.orchestrator} capabilities={capabilities} disabled={flow.controlsDisabled} onChange={flow.setOrchestrator} />
        <p className="text-xs text-muted-foreground">默认沿用当前聊天的模型和推理强度；可在这里分别调整，启动 Mission 时应用。</p>
      </section>
      <Collapsible className="v2-mission-execution" open={advanced} onOpenChange={setAdvanced} disabled={flow.controlsDisabled}>
        <CollapsibleTrigger asChild><Button variant="ghost" className="v2-mission-settings-trigger" aria-label="Advanced Mission settings" disabled={flow.controlsDisabled}>
          <SlidersHorizontal aria-hidden="true" className="v2-mission-section-icon" />
          <span className="min-w-0 flex-1"><span className="block font-medium">Execution settings</span><span className="block text-xs font-normal text-muted-foreground">{inheritedProfiles ? 'Worker & Validator inherit Orchestrator' : 'Custom Worker / Validator profiles'}</span><span className="block text-xs font-normal text-muted-foreground">{flow.enabledValidationCount} {flow.enabledValidationCount === 1 ? 'check' : 'checks'} enabled</span></span>
          <ChevronDown aria-hidden="true" className="v2-mission-settings-chevron" />
        </Button></CollapsibleTrigger>
        <CollapsibleContent className="v2-mission-settings-content">
          <div className="v2-mission-settings-fields">
            <ProfileFields name="Worker" profile={flow.worker} orchestrator={flow.orchestrator} capabilities={capabilities} disabled={flow.controlsDisabled} onChange={flow.setWorker} />
            <ProfileFields name="Validator" profile={flow.validator} orchestrator={flow.orchestrator} capabilities={capabilities} disabled={flow.controlsDisabled} onChange={flow.setValidator} />
            <fieldset className="v2-mission-checks min-w-0"><legend className="font-medium">Validation checks</legend>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">Both checks use the shared Validator profile configured above.</p>
              <MissionToggle label="Run Scrutiny" description="Review the completed feature for implementation risks." checked={flow.scrutinyEnabled} disabled={flow.controlsDisabled} onChange={flow.setScrutinyEnabled} />
              <MissionToggle label="Run User Testing" description="Validate the finished flow through its user-facing surface." checked={flow.userTestingEnabled} disabled={flow.controlsDisabled} onChange={flow.setUserTestingEnabled} />
            </fieldset>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
    <footer className="v2-mission-setup-actions">
      <p role="status" aria-live="polite" aria-label="Mission setup status" className={`v2-mission-setup-feedback ${flow.visibleErrors.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{flow.status || startHint}</p>
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" className="h-9" aria-label="Dismiss Mission setup" disabled={flow.controlsDisabled} onClick={onDismiss}>Cancel setup</Button>
        <Button className="h-9 min-w-32" disabled={flow.pending || startDisabled || flow.validation.errors.length > 0} onClick={flow.submit}>{flow.pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Play />}{flow.pending ? 'Starting…' : 'Start Mission'}</Button>
      </div>
    </footer>
  </section>;
}

function SectionHeading({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return <header className="v2-mission-section-heading"><span aria-hidden="true" className="v2-mission-section-icon">{icon}</span>
    <div className="min-w-0"><h2 className="font-medium">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
  </header>;
}

function PairFields({ name, pair, capabilities, disabled, onChange }: {
  readonly name: string; readonly pair: MissionPair; readonly capabilities: MissionSetupCapabilities;
  readonly disabled: boolean; readonly onChange: (value: MissionPair) => void;
}) {
  const model = capabilities.catalog.find((item) => item.id === pair.modelId);
  const efforts = model?.supportedReasoningEfforts.length ? model.supportedReasoningEfforts
    : model?.defaultReasoningEffort ? [model.defaultReasoningEffort] : [];
  const modelOptions = capabilities.catalog.map((item) => ({ ...item,
    description: capabilities.catalog.some((other) => other.id !== item.id &&
      other.displayName === item.displayName && other.isCustom === item.isCustom) ? item.id : undefined }));
  return <div className="mission-pair">
    <div className="grid min-w-0 gap-1.5 text-xs">
    <span className="text-muted-foreground">{name} 模型</span>
    <ModelSourceSelect label={`${name} model`} value={pair.modelId || undefined} models={modelOptions}
      disabled={disabled} onChange={(modelId) => {
        const selected = capabilities.catalog.find((item) => item.id === modelId);
        onChange({ modelId, reasoningEffort: selected?.supportedReasoningEfforts.includes(pair.reasoningEffort)
          ? pair.reasoningEffort : selected?.defaultReasoningEffort ?? selected?.supportedReasoningEfforts[0] ?? pair.reasoningEffort });
      }} placeholder="Choose an available model" />
    </div>
    <MissionSelect label={`${name} reasoning`} fieldLabel={`${name} 推理强度`} value={efforts.includes(pair.reasoningEffort) ? pair.reasoningEffort : ''}
      options={efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))} disabled={disabled || model?.supportedReasoningEfforts.length === 0}
      onChange={(value) => onChange({ ...pair, reasoningEffort: value as MissionReasoningEffort })} placeholder="Choose available reasoning" />
  </div>;
}

function ProfileFields({ name, profile, orchestrator, capabilities, disabled, onChange }: {
  readonly name: 'Worker' | 'Validator'; readonly profile: MissionProfile; readonly capabilities: MissionSetupCapabilities;
  readonly orchestrator: MissionPair;
  readonly disabled: boolean; readonly onChange: (value: MissionProfile) => void;
}) {
  return <fieldset className="v2-mission-profile min-w-0"><legend className="font-medium">{name}</legend>
    <div className="v2-mission-profile-fields">
    <p className="text-xs text-muted-foreground">{name === 'Worker' ? 'Executes one feature at a time under the Orchestrator.' : 'Provides the shared profile for all quality checks.'}</p>
    <MissionSelect label={`${name} inheritance`} fieldLabel="Configuration" value={profile.mode} disabled={disabled}
      options={[{ value: 'same-as-orchestrator', label: 'Same as orchestrator' }, { value: 'override', label: 'Choose independently' }]}
      onChange={(value) => onChange({ mode: value === 'same-as-orchestrator' ? value : 'override', ...orchestrator })} />
    {profile.mode === 'override' ? <PairFields name={name} pair={profile} capabilities={capabilities} disabled={disabled} onChange={(pair) => onChange({ ...profile, ...pair })} /> : null}
    </div>
  </fieldset>;
}

function MissionToggle({ label, description, checked, disabled, onChange }: {
  readonly label: string; readonly description: string; readonly checked: boolean;
  readonly disabled: boolean; readonly onChange: (value: boolean) => void;
}) {
  return <label className="v2-mission-toggle relative flex items-center gap-3 rounded-md px-2 py-3">
    <span className={`min-w-0 flex-1 ${disabled ? 'opacity-50' : ''}`}><strong className="block font-medium">{label}</strong><small className="mt-1 block text-xs text-muted-foreground">{description}</small></span>
    <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </label>;
}
