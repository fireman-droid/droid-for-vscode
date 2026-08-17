import { useEffect, useMemo, useState } from 'react';

import {
  MAX_MISSION_TASK_LENGTH,
  isMissionTaskText,
  missionPairError,
  resolveMissionProfile,
  type MissionProfile,
  type MissionReasoningEffort,
  type MissionSetupCapabilities,
} from '../../../shared/missionProtocol';
import type { MissionSetupSubmission } from './missionStart';

export interface MissionSetupResult {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected';
}

interface MissionSetupProps {
  readonly capabilities: MissionSetupCapabilities;
  readonly initialTask: string;
  readonly onStart: (submission: MissionSetupSubmission) => string | null;
  readonly onDismiss: () => void;
  readonly result?: MissionSetupResult | null;
}

interface Pair {
  readonly modelId: string;
  readonly reasoningEffort: MissionReasoningEffort;
}

interface Validation {
  readonly errors: readonly string[];
  readonly submission: MissionSetupSubmission;
}

export function createMissionSetupSubmission(
  capabilities: MissionSetupCapabilities,
  task: string,
): MissionSetupSubmission {
  const orchestrator = capabilities.currentChat;
  return {
    task: task.trim(),
    orchestrator,
    worker: resolveMissionProfile(capabilities.preferences.worker, orchestrator),
    validator: resolveMissionProfile(
      capabilities.preferences.validator,
      orchestrator,
    ),
    scrutinyEnabled: capabilities.preferences.scrutinyEnabled,
    userTestingEnabled: capabilities.preferences.userTestingEnabled,
  };
}

export function validateMissionSetupSubmission(
  capabilities: MissionSetupCapabilities,
  submission: MissionSetupSubmission,
): readonly string[] {
  const errors: string[] = [];
  if (submission.task.length === 0) {
    errors.push('Enter a Mission task.');
  } else if (submission.task.length > MAX_MISSION_TASK_LENGTH) {
    errors.push('The Mission task is too long.');
  } else if (!isMissionTaskText(submission.task)) {
    errors.push(
      'The Mission task contains unsupported control characters or a filesystem path.',
    );
  }
  if (capabilities.catalogStatus !== 'ready') {
    errors.push('The Mission model catalog is unavailable.');
  }
  validatePair(
    'Orchestrator',
    submission.orchestrator,
    capabilities,
    errors,
  );
  validatePair('Worker', submission.worker, capabilities, errors);
  validatePair('Validator', submission.validator, capabilities, errors);
  return errors;
}

export function MissionSetup({
  capabilities,
  initialTask,
  onStart,
  onDismiss,
  result = null,
}: MissionSetupProps): React.JSX.Element {
  const [task, setTask] = useState(initialTask);
  const [orchestrator, setOrchestrator] = useState<Pair>(
    capabilities.currentChat,
  );
  const [worker, setWorker] = useState<MissionProfile>(
    capabilities.preferences.worker,
  );
  const [validator, setValidator] = useState<MissionProfile>(
    capabilities.preferences.validator,
  );
  const [scrutinyEnabled, setScrutinyEnabled] = useState(
    capabilities.preferences.scrutinyEnabled,
  );
  const [userTestingEnabled, setUserTestingEnabled] = useState(
    capabilities.preferences.userTestingEnabled,
  );
  const [advanced, setAdvanced] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [settlement, setSettlement] = useState('');

  useEffect(() => {
    if (
      pendingRequestId !== null &&
      result?.requestId === pendingRequestId &&
      result.status === 'rejected'
    ) {
      setPendingRequestId(null);
      setSettlement(
        'Mission could not start. Review the unchanged settings and try again.',
      );
    }
  }, [pendingRequestId, result]);

  const validation = useMemo<Validation>(() => {
    const submission: MissionSetupSubmission = {
      task: task.trim(),
      orchestrator,
      worker: resolveMissionProfile(worker, orchestrator),
      validator: resolveMissionProfile(validator, orchestrator),
      scrutinyEnabled,
      userTestingEnabled,
    };
    return {
      submission,
      errors: validateMissionSetupSubmission(capabilities, submission),
    };
  }, [
    capabilities,
    orchestrator,
    scrutinyEnabled,
    task,
    userTestingEnabled,
    validator,
    worker,
  ]);
  const pending = pendingRequestId !== null;
  const controlsDisabled = pending;

  const submit = (): void => {
    if (pending || validation.errors.length > 0) {
      return;
    }
    const requestId = onStart(validation.submission);
    if (requestId !== null) {
      setSettlement('Starting Mission…');
      setPendingRequestId(requestId);
    }
  };

  return (
    <section className="dvx-mission-setup" aria-labelledby="dvx-mission-title">
      <div className="dvx-mission-setup-head">
        <div>
          <h2 id="dvx-mission-title">Start a Mission</h2>
          <p>Configure one orchestrator with serial Worker execution.</p>
        </div>
        <button
          type="button"
          className="dvx-mission-dismiss"
          aria-label="Dismiss Mission setup"
          disabled={controlsDisabled}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>

      <label className="dvx-mission-field">
        <span>Mission task</span>
        <textarea
          aria-label="Mission task"
          value={task}
          maxLength={MAX_MISSION_TASK_LENGTH + 1}
          disabled={controlsDisabled}
          onChange={(event) => setTask(event.currentTarget.value)}
        />
      </label>

      <div className="dvx-mission-pair">
        <ModelSelect
          label="Orchestrator model"
          value={orchestrator.modelId}
          capabilities={capabilities}
          disabled={controlsDisabled}
          onChange={(modelId) =>
            setOrchestrator((current) => ({ ...current, modelId }))
          }
        />
        <ReasoningSelect
          label="Orchestrator reasoning"
          pair={orchestrator}
          capabilities={capabilities}
          disabled={controlsDisabled}
          onChange={(reasoningEffort) =>
            setOrchestrator((current) => ({
              ...current,
              reasoningEffort,
            }))
          }
        />
      </div>

      <button
        type="button"
        className="dvx-mission-advanced"
        aria-expanded={advanced}
        aria-controls="dvx-mission-advanced-fields"
        disabled={controlsDisabled}
        onClick={() => setAdvanced((value) => !value)}
      >
        Advanced Mission settings
      </button>

      {advanced ? (
        <div id="dvx-mission-advanced-fields" className="dvx-mission-advanced-fields">
          <ProfileFields
            name="Worker"
            profile={worker}
            capabilities={capabilities}
            disabled={controlsDisabled}
            onChange={setWorker}
          />
          <ProfileFields
            name="Validator"
            profile={validator}
            capabilities={capabilities}
            disabled={controlsDisabled}
            onChange={setValidator}
          />
          <p className="dvx-mission-shared-note">
            The shared Validator profile is used by Scrutiny and User Testing.
          </p>
          <label className="dvx-mission-check">
            <input
              type="checkbox"
              checked={scrutinyEnabled}
              disabled={controlsDisabled}
              onChange={(event) => setScrutinyEnabled(event.currentTarget.checked)}
            />
            <span>Run Scrutiny</span>
          </label>
          <label className="dvx-mission-check">
            <input
              type="checkbox"
              checked={userTestingEnabled}
              disabled={controlsDisabled}
              onChange={(event) =>
                setUserTestingEnabled(event.currentTarget.checked)
              }
            />
            <span>Run User Testing</span>
          </label>
        </div>
      ) : null}

      <div
        className="dvx-mission-status"
        role="status"
        aria-label="Mission setup status"
        aria-live="polite"
      >
        {validation.errors.length > 0
          ? validation.errors.join(' ')
          : settlement}
      </div>
      <div className="dvx-mission-actions">
        <button
          type="button"
          className="dvx-mission-start"
          disabled={pending || validation.errors.length > 0}
          onClick={submit}
        >
          {pending ? 'Starting…' : 'Start Mission'}
        </button>
      </div>
    </section>
  );
}

function ProfileFields({
  name,
  profile,
  capabilities,
  disabled,
  onChange,
}: {
  readonly name: 'Worker' | 'Validator';
  readonly profile: MissionProfile;
  readonly capabilities: MissionSetupCapabilities;
  readonly disabled: boolean;
  readonly onChange: (profile: MissionProfile) => void;
}): React.JSX.Element {
  const inherited = profile.mode === 'same-as-orchestrator';
  return (
    <fieldset className="dvx-mission-profile">
      <legend>{name}</legend>
      <label className="dvx-mission-field">
        <span>{name} inheritance</span>
        <select
          aria-label={`${name} inheritance`}
          value={profile.mode}
          disabled={disabled}
          onChange={(event) => {
            const mode = event.currentTarget.value as MissionProfile['mode'];
            onChange(
              mode === 'same-as-orchestrator'
                ? {
                    mode,
                    ...capabilities.currentChat,
                  }
                : { ...profile, mode },
            );
          }}
        >
          <option value="same-as-orchestrator">Same as orchestrator</option>
          <option value="override">Choose independently</option>
        </select>
      </label>
      {inherited ? null : (
        <div className="dvx-mission-pair">
          <ModelSelect
            label={`${name} model`}
            value={profile.modelId}
            capabilities={capabilities}
            disabled={disabled}
            onChange={(modelId) => onChange({ ...profile, modelId })}
          />
          <ReasoningSelect
            label={`${name} reasoning`}
            pair={profile}
            capabilities={capabilities}
            disabled={disabled}
            onChange={(reasoningEffort) =>
              onChange({ ...profile, reasoningEffort })
            }
          />
        </div>
      )}
    </fieldset>
  );
}

function ModelSelect({
  label,
  value,
  capabilities,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly capabilities: MissionSetupCapabilities;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const available = capabilities.catalog.some((model) => model.id === value);
  return (
    <label className="dvx-mission-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={available ? value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="" disabled>
          Choose an available model
        </option>
        {capabilities.catalog.map((model) => (
          <option key={model.id} value={model.id}>
            {model.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReasoningSelect({
  label,
  pair,
  capabilities,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly pair: Pair;
  readonly capabilities: MissionSetupCapabilities;
  readonly disabled: boolean;
  readonly onChange: (value: MissionReasoningEffort) => void;
}): React.JSX.Element {
  const efforts =
    capabilities.catalog.find((model) => model.id === pair.modelId)
      ?.supportedReasoningEfforts ?? [];
  const available = efforts.includes(pair.reasoningEffort);
  return (
    <label className="dvx-mission-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={available ? pair.reasoningEffort : ''}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.currentTarget.value as MissionReasoningEffort)
        }
      >
        <option value="" disabled>
          Choose available reasoning
        </option>
        {efforts.map((effort) => (
          <option key={effort} value={effort}>
            {formatEffort(effort)}
          </option>
        ))}
      </select>
    </label>
  );
}

function validatePair(
  label: string,
  pair: Pair,
  capabilities: MissionSetupCapabilities,
  errors: string[],
): void {
  const error = missionPairError(pair, capabilities.catalog);
  if (error === 'unavailable-model') {
    errors.push(`The ${label} model is unavailable.`);
  } else if (error === 'unsupported-reasoning') {
    errors.push(`The ${label} reasoning is unavailable for this model.`);
  }
}

function formatEffort(value: string): string {
  return value === 'xhigh'
    ? 'Extra high'
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
