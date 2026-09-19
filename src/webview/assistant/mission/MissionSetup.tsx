import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  MAX_MISSION_TASK_LENGTH,
  type MissionProfile,
  type MissionReasoningEffort,
  type MissionSetupCapabilities,
} from '../../../shared/protocol/missionProtocol';
import { useMissionSetupFlow, type MissionSetupProps, type MissionPair as Pair } from './missionSetupFlow';
export { createMissionSetupSubmission, validateMissionSetupSubmission, type MissionSetupResult } from './missionSetupFlow';

interface MissionSelectOption {
  readonly value: string;
  readonly label: string;
}

export function MissionSetup({
  capabilities,
  initialTask,
  onStart,
  onDismiss,
  result = null,
  startDisabled = false,
}: MissionSetupProps): React.JSX.Element {
  const { task, setTask, orchestrator, setOrchestrator, worker, setWorker, validator, setValidator,
    scrutinyEnabled, setScrutinyEnabled, userTestingEnabled, setUserTestingEnabled,
    pending, controlsDisabled, visibleErrors, status, enabledValidationCount, validation, submit } =
    useMissionSetupFlow({ capabilities, initialTask, onStart, onDismiss, result, startDisabled });
  const [advanced, setAdvanced] = useState(false);
  const [advancedMounted, setAdvancedMounted] = useState(false);

  useEffect(() => {
    if (advanced || !advancedMounted) {
      return undefined;
    }
    const reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      setAdvancedMounted(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setAdvancedMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [advanced, advancedMounted]);


  return (
    <section className="dvx-mission-setup" aria-labelledby="dvx-mission-title">
      <div className="dvx-mission-setup-head">
        <div className="dvx-mission-heading">
          <span className="dvx-mission-eyebrow">Mission brief</span>
          <h2 id="dvx-mission-title">Start a Mission</h2>
          <p>Define the outcome. Droid coordinates the execution.</p>
        </div>
        <button
          type="button"
          className="dvx-mission-dismiss"
          aria-label="Dismiss Mission setup"
          disabled={controlsDisabled}
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <label className="dvx-mission-field dvx-mission-task">
        <span>What should this Mission deliver?</span>
        <small id="dvx-mission-task-hint">
          Describe a concrete outcome, not a list of implementation steps.
        </small>
        <textarea
          aria-label="Mission task"
          aria-describedby="dvx-mission-task-hint"
          value={task}
          autoFocus
          rows={4}
          placeholder="For example: ship the new onboarding flow with tests and visual QA"
          maxLength={MAX_MISSION_TASK_LENGTH + 1}
          disabled={controlsDisabled}
          onChange={(event) => setTask(event.currentTarget.value)}
        />
      </label>

      <div className="dvx-mission-orchestrator">
        <div className="dvx-mission-section-head">
          <div>
            <span>Orchestrator</span>
            <small>Owns the plan and coordinates each Worker.</small>
          </div>
          <span className="dvx-mission-current">Current chat</span>
        </div>
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
      </div>

      <div className="dvx-mission-route" aria-label="Mission execution flow">
        <ExecutionStep
          label="Orchestrator"
          detail={`${readModelLabel(capabilities, orchestrator.modelId)} · ${formatEffort(orchestrator.reasoningEffort)}`}
        />
        <ExecutionStep label="Worker" detail={readProfileSummary(capabilities, worker)} />
        <ExecutionStep
          label="Validation"
          detail={`${enabledValidationCount} ${enabledValidationCount === 1 ? 'check' : 'checks'} enabled`}
        />
      </div>

      <button
        type="button"
        className="dvx-mission-advanced"
        aria-label="Advanced Mission settings"
        aria-expanded={advanced}
        aria-controls="dvx-mission-advanced-fields"
        disabled={controlsDisabled}
        onClick={() => {
          if (advanced) {
            setAdvanced(false);
          } else {
            setAdvancedMounted(true);
            setAdvanced(true);
          }
        }}
      >
        <span>Execution settings</span>
        <span className="dvx-mission-advanced-hint">
          Worker, Validator, and quality checks
        </span>
        <span className="dvx-mission-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      {advancedMounted ? (
        <div
          id="dvx-mission-advanced-fields"
          className="dvx-mission-advanced-shell"
          data-open={advanced}
          aria-hidden={!advanced}
        >
          <div className="dvx-mission-advanced-fields">
            <ProfileFields
              name="Worker"
              profile={worker}
              capabilities={capabilities}
              disabled={controlsDisabled || !advanced}
              onChange={setWorker}
            />
            <ProfileFields
              name="Validator"
              profile={validator}
              capabilities={capabilities}
              disabled={controlsDisabled || !advanced}
              onChange={setValidator}
            />
            <fieldset className="dvx-mission-quality">
              <legend>Validation checks</legend>
              <p>Both checks use the shared Validator profile configured above.</p>
              <MissionToggle
                label="Run Scrutiny"
                description="Review the completed feature for implementation risks."
                checked={scrutinyEnabled}
                disabled={controlsDisabled || !advanced}
                onChange={setScrutinyEnabled}
              />
              <MissionToggle
                label="Run User Testing"
                description="Validate the finished flow through its user-facing surface."
                checked={userTestingEnabled}
                disabled={controlsDisabled || !advanced}
                onChange={setUserTestingEnabled}
              />
            </fieldset>
          </div>
        </div>
      ) : null}

      <div className="dvx-mission-footer">
        <div
          className="dvx-mission-status"
          data-state={visibleErrors.length > 0 ? 'error' : 'neutral'}
          role="status"
          aria-label="Mission setup status"
          aria-live="polite"
        >
          {status}
        </div>
        <button
          type="button"
          className="dvx-mission-start"
          disabled={pending || startDisabled || validation.errors.length > 0}
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
      <p>
        {name === 'Worker'
          ? 'Executes one feature at a time under the Orchestrator.'
          : 'Provides the shared profile for all quality checks.'}
      </p>
      <CompactSelect
        label={`${name} inheritance`}
        fieldLabel="Configuration"
        value={profile.mode}
        options={[
          {
            value: 'same-as-orchestrator',
            label: 'Same as orchestrator',
          },
          { value: 'override', label: 'Choose independently' },
        ]}
        menuLabel="Configuration"
        placeholder="Choose configuration"
        disabled={disabled}
        onChange={(value) => {
          const mode = value as MissionProfile['mode'];
          onChange(
            mode === 'same-as-orchestrator'
              ? {
                  mode,
                  ...capabilities.currentChat,
                }
              : { ...profile, mode },
          );
        }}
      />
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
            onChange={(reasoningEffort) => onChange({ ...profile, reasoningEffort })}
          />
        </div>
      )}
    </fieldset>
  );
}

function ExecutionStep({
  label,
  detail,
}: {
  readonly label: string;
  readonly detail: string;
}): React.JSX.Element {
  return (
    <div className="dvx-mission-route-step">
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

function MissionToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="dvx-mission-toggle">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="dvx-mission-toggle-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="dvx-mission-switch" aria-hidden="true">
        <span />
      </span>
    </label>
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
  return (
    <CompactSelect
      label={label}
      value={value}
      options={capabilities.catalog.map((model) => ({
        value: model.id,
        label: model.displayName,
      }))}
      menuLabel="Available models"
      placeholder="Choose an available model"
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function CompactSelect({
  label,
  fieldLabel = label,
  value,
  options,
  menuLabel,
  placeholder,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly fieldLabel?: string;
  readonly value: string;
  readonly options: readonly MissionSelectOption[];
  readonly menuLabel: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openMenu = (index = selectedIndex >= 0 ? selectedIndex : 0): void => {
    if (disabled || options.length === 0) {
      return;
    }
    const triggerBounds = triggerRef.current?.getBoundingClientRect();
    if (triggerBounds) {
      const spaceBelow = window.innerHeight - triggerBounds.bottom;
      setPlacement(spaceBelow < 164 && triggerBounds.top > spaceBelow ? 'top' : 'bottom');
    }
    setActiveIndex(index);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false): void => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const dismiss = (event: KeyboardEvent | PointerEvent): void => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu(true);
        }
        return;
      }
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        closeMenu();
      }
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (disabled || options.length === 0) {
      setOpen(false);
    } else if (activeIndex >= options.length) {
      setActiveIndex(options.length - 1);
    }
  }, [activeIndex, disabled, options.length]);

  useEffect(() => {
    if (open) {
      optionRefs.current[activeIndex]?.scrollIntoView?.({
        block: 'nearest',
      });
    }
  }, [activeIndex, open]);

  const selectModel = (modelId: string): void => {
    onChange(modelId);
    closeMenu(true);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const lastIndex = options.length - 1;
    if (lastIndex < 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu(open ? Math.min(activeIndex + 1, lastIndex) : undefined);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(open ? Math.max(activeIndex - 1, 0) : undefined);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      openMenu(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      openMenu(lastIndex);
      return;
    }
    if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const activeOption = options[activeIndex];
      if (activeOption) {
        selectModel(activeOption.value);
      }
    }
  };

  return (
    <div
      className="dvx-mission-field"
      ref={rootRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          open &&
          (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget))
        ) {
          closeMenu();
        }
      }}
    >
      <span>{fieldLabel}</span>
      <div className="dvx-mission-picker" data-placement={placement}>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          className="dvx-mission-picker-trigger"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
          disabled={disabled || options.length === 0}
          onClick={() => {
            if (open) {
              closeMenu();
            } else {
              openMenu();
            }
          }}
          onKeyDown={handleKeyDown}
        >
          <span className="dvx-mission-picker-value">
            {selectedOption?.label ?? placeholder}
          </span>
          <span className="dvx-mission-picker-chevron" aria-hidden="true" />
        </button>
        {open ? (
          <div
            id={listboxId}
            className="dvx-mission-picker-menu"
            role="listbox"
            aria-label={`${label} options`}
          >
            <span className="dvx-mission-picker-menu-label">{menuLabel}</span>
            <div className="dvx-mission-picker-options">
              {options.map((option, index) => {
                const selected = option.value === value;
                return (
                  <button
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    id={`${listboxId}-option-${index}`}
                    key={option.value}
                    type="button"
                    className="dvx-mission-picker-option"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    data-active={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectModel(option.value)}
                  >
                    <span>{option.label}</span>
                    {selected ? (
                      <span className="dvx-mission-picker-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
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
    <CompactSelect
      label={label}
      value={available ? pair.reasoningEffort : ''}
      options={efforts.map((effort) => ({
        value: effort,
        label: formatEffort(effort),
      }))}
      menuLabel="Reasoning effort"
      placeholder="Choose available reasoning"
      disabled={disabled}
      onChange={(value) => onChange(value as MissionReasoningEffort)}
    />
  );
}

function readProfileSummary(
  capabilities: MissionSetupCapabilities,
  profile: MissionProfile,
): string {
  return profile.mode === 'same-as-orchestrator'
    ? 'Inherits orchestrator'
    : `${readModelLabel(capabilities, profile.modelId)} · ${formatEffort(profile.reasoningEffort)}`;
}

function readModelLabel(capabilities: MissionSetupCapabilities, modelId: string): string {
  return (
    capabilities.catalog.find((model) => model.id === modelId)?.displayName ?? modelId
  );
}

function formatEffort(value: string): string {
  return value === 'xhigh'
    ? 'Extra high'
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
