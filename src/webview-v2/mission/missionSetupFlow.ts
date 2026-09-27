import { useEffect, useMemo, useState } from 'react';
import { MAX_MISSION_TASK_LENGTH, isMissionTaskText, missionPairError, resolveMissionProfile, type MissionProfile, type MissionReasoningEffort, type MissionSetupCapabilities } from '../../shared/protocol/missionProtocol';
import type { MissionSetupSubmission } from './missionStart';

export interface MissionSetupResult {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected';
}
export interface MissionSetupProps {
  readonly capabilities: MissionSetupCapabilities;
  readonly initialTask: string;
  readonly onStart: (submission: MissionSetupSubmission) => string | null;
  readonly onDismiss: () => void;
  readonly result?: MissionSetupResult | null;
  readonly startDisabled?: boolean;
}
export interface MissionPair {
  readonly modelId: string;
  readonly reasoningEffort: MissionReasoningEffort;
}
export function createMissionSetupSubmission(capabilities: MissionSetupCapabilities, task: string): MissionSetupSubmission {
  const orchestrator = capabilities.currentChat;
  return {
    task: task.trim(), orchestrator,
    worker: resolveMissionProfile(capabilities.preferences.worker, orchestrator),
    validator: resolveMissionProfile(capabilities.preferences.validator, orchestrator),
    scrutinyEnabled: capabilities.preferences.scrutinyEnabled,
    userTestingEnabled: capabilities.preferences.userTestingEnabled,
  };
}
export function validateMissionSetupSubmission(capabilities: MissionSetupCapabilities, submission: MissionSetupSubmission): readonly string[] {
  const errors: string[] = [];
  if (submission.task.length === 0) errors.push('Enter a Mission task.');
  else if (submission.task.length > MAX_MISSION_TASK_LENGTH) errors.push('The Mission task is too long.');
  else if (!isMissionTaskText(submission.task)) errors.push('The Mission task contains unsupported control characters or a filesystem path.');
  if (capabilities.catalogStatus !== 'ready') errors.push('The Mission model catalog is unavailable.');
  for (const [label, pair] of [['Orchestrator', submission.orchestrator], ['Worker', submission.worker], ['Validator', submission.validator]] as const) {
    const error = missionPairError(pair, capabilities.catalog);
    if (error === 'unavailable-model') errors.push(`The ${label} model is unavailable.`);
    else if (error === 'unsupported-reasoning') errors.push(`The ${label} reasoning is unavailable for this model.`);
  }
  return errors;
}
export function useMissionSetupFlow({ capabilities, initialTask, onStart, result = null, startDisabled = false }: MissionSetupProps) {
  const [task, setTask] = useState(initialTask);
  const [orchestrator, setOrchestrator] = useState<MissionPair>(capabilities.currentChat);
  const [worker, setWorker] = useState<MissionProfile>(capabilities.preferences.worker);
  const [validator, setValidator] = useState<MissionProfile>(capabilities.preferences.validator);
  const [scrutinyEnabled, setScrutinyEnabled] = useState(capabilities.preferences.scrutinyEnabled);
  const [userTestingEnabled, setUserTestingEnabled] = useState(capabilities.preferences.userTestingEnabled);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [settlement, setSettlement] = useState('');
  useEffect(() => {
    if (pendingRequestId !== null && result?.requestId === pendingRequestId && result.status === 'rejected') {
      setPendingRequestId(null);
      setSettlement('Mission could not start. Review the unchanged settings and try again.');
    }
  }, [pendingRequestId, result]);
  const validation = useMemo(() => {
    const submission: MissionSetupSubmission = {
      task: task.trim(), orchestrator, worker: resolveMissionProfile(worker, orchestrator),
      validator: resolveMissionProfile(validator, orchestrator), scrutinyEnabled, userTestingEnabled,
    };
    return { submission, errors: validateMissionSetupSubmission(capabilities, submission) };
  }, [capabilities, task, orchestrator, worker, validator, scrutinyEnabled, userTestingEnabled]);
  const pending = pendingRequestId !== null;
  const visibleErrors = validation.errors.filter((error) => error !== 'Enter a Mission task.');
  const status = visibleErrors.length > 0 ? visibleErrors.join(' ') : settlement;
  const submit = () => {
    if (pending || startDisabled || validation.errors.length > 0) return;
    const requestId = onStart(validation.submission);
    if (requestId !== null) { setSettlement('Starting Mission…'); setPendingRequestId(requestId); }
  };
  return { task, setTask, orchestrator, setOrchestrator, worker, setWorker, validator, setValidator,
    scrutinyEnabled, setScrutinyEnabled, userTestingEnabled, setUserTestingEnabled, pending,
    controlsDisabled: pending, validation, visibleErrors, status, submit,
    enabledValidationCount: Number(scrutinyEnabled) + Number(userTestingEnabled) };
}
