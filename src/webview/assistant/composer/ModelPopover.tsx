// Model picker popover (spec §5.1, cursor/模型卡片.png): borderless
// search crown, quiet 27px rows with the check on the right edge and
// the effort pencil riding the name, a reasoning flyout, a drill-in
// sub-view for the spec drafting override, and a fixed "Add models"
// foot that opens the full-page model manager. Also exports the
// model-name helpers the trigger consumes.

import { useContext, useMemo, useState } from 'react';

import type {
  ConfirmedSessionSettings,
  ModelCatalogItem,
  ModelCatalogState,
  SessionReasoningEffort,
  SessionSettingsState,
} from '../../../shared/bridgeMessages';
import { CustomModelsContext } from '../customModelsFlow';
import type { SessionSettingSelection } from '../useOptimisticSetting';
import {
  ChevronDownIcon,
  SettingsStatus,
  Stat,
  formatReasoningLabel,
} from './shared';

export function ModelPopover({
  id,
  settings,
  modelCatalog,
  disabled,
  onUpdate,
  onManageModels,
}: {
  readonly id: string;
  readonly settings: SessionSettingsState;
  readonly modelCatalog: ModelCatalogState;
  readonly disabled: boolean;
  readonly onUpdate: (
    update: Extract<
      SessionSettingSelection,
      { field: 'modelId' | 'reasoningEffort' | 'specModeModelId' | 'specModeReasoningEffort' }
    >,
  ) => void;
  /** Closes the popover; the entry row itself opens the manager page. */
  readonly onManageModels: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [editingReasoning, setEditingReasoning] = useState(false);
  const [view, setView] = useState<'root' | 'spec'>('root');
  const confirmed = settings.value;
  const isSpecView = view === 'spec';
  const specModelOverrideId = confirmed?.specModeModelId ?? null;
  // An unset drafting model inherits the session model; "Same as
  // session" carries that state on its own row, so a model row only
  // checks when specModeModelId names it explicitly (no double tick).
  const effectiveModelId = isSpecView
    ? (specModelOverrideId ?? confirmed?.modelId)
    : confirmed?.modelId;
  const rowMatchId = isSpecView ? (specModelOverrideId ?? undefined) : effectiveModelId;
  const scopedReasoning = isSpecView
    ? (confirmed?.specModeReasoningEffort ?? undefined)
    : confirmed?.reasoningEffort;
  const usesSessionModel = isSpecView && specModelOverrideId === null;
  const selected =
    confirmed === null || modelCatalog.status !== 'ready'
      ? undefined
      : modelCatalog.items.find((item) => item.id === effectiveModelId);
  const goToView = (next: 'root' | 'spec'): void => {
    setView(next);
    setEditingReasoning(false);
    setQuery('');
  };
  const filtered = useMemo(() => {
    if (modelCatalog.status !== 'ready') {
      return [];
    }
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) {
      return modelCatalog.items;
    }
    return modelCatalog.items.filter(
      (model) =>
        model.displayName.toLocaleLowerCase().includes(normalized) ||
        model.id.toLocaleLowerCase().includes(normalized),
    );
  }, [modelCatalog, query]);

  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-model-popover"
      role="dialog"
      aria-label={isSpecView ? 'Spec drafting model' : 'Model'}
    >
      {modelCatalog.status === 'ready' ? (
        <>
          {editingReasoning && selected !== undefined ? (
            <div className="dvx-reasoning-flyout">
              <ReasoningEditor
                model={selected}
                current={scopedReasoning}
                disabled={disabled}
                defaultOptionLabel={
                  isSpecView ? 'Model default' : undefined
                }
                onSelect={(effort) =>
                  isSpecView
                    ? onUpdate({
                        field: 'specModeReasoningEffort',
                        value: effort,
                      })
                    : effort !== null &&
                      onUpdate({
                        field: 'reasoningEffort',
                        value: effort,
                      })
                }
              />
            </div>
          ) : null}
          <div className="dvx-model-panel">
            {isSpecView ? (
              <div className="dvx-panel-head">
                <button
                  type="button"
                  className="dvx-panel-back"
                  aria-label="Back to model"
                  onClick={() => goToView('root')}
                >
                  <ChevronLeftIcon />
                  <span className="dvx-panel-title">Spec drafting</span>
                </button>
              </div>
            ) : null}
            <label className="dvx-visually-hidden" htmlFor={`${id}-search`}>
              Search BYOK models
            </label>
            <input
              id={`${id}-search`}
              className="dvx-model-search"
              type="search"
              value={query}
              placeholder="Search models"
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <div
              className="dvx-model-list"
              role="list"
              aria-label={isSpecView ? 'Spec drafting models' : 'BYOK models'}
            >
              {isSpecView ? (
                <>
                  <div
                    className="dvx-model-row"
                    role="listitem"
                    aria-current={usesSessionModel ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      className="dvx-model-choice"
                      aria-label="Same as session"
                      disabled={disabled}
                      onClick={() => {
                        if (usesSessionModel) {
                          return;
                        }
                        onUpdate({ field: 'specModeModelId', value: null });
                      }}
                    >
                      <span className="dvx-model-name">Same as session</span>
                      {usesSessionModel ? (
                        <span className="dvx-model-effort-suffix">
                          {scopedReasoning === undefined
                            ? 'Default'
                            : formatReasoningLabel(scopedReasoning)}
                        </span>
                      ) : null}
                    </button>
                    {usesSessionModel ? (
                      <>
                        <button
                          type="button"
                          className="dvx-model-edit"
                          aria-label="Edit reasoning for the session model"
                          disabled={
                            disabled ||
                            selected === undefined ||
                            selected.supportedReasoningEfforts.length === 0
                          }
                          onClick={() => setEditingReasoning(true)}
                        >
                          <PencilIcon />
                        </button>
                        <CheckIcon className="dvx-model-check" />
                      </>
                    ) : null}
                  </div>
                  <div className="dvx-settings-divider" />
                </>
              ) : null}
              {filtered.map((model) => {
                const isSelected = model.id === rowMatchId;
                const modelLabel = model.displayName;
                return (
                  <div
                    key={model.id}
                    className="dvx-model-row"
                    role="listitem"
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      className="dvx-model-choice"
                      aria-label={`${model.displayName}, ${model.id}`}
                      title={model.id}
                      disabled={disabled}
                      onClick={() => {
                        if (isSelected) {
                          return;
                        }
                        onUpdate(
                          isSpecView
                            ? {
                                field: 'specModeModelId',
                                value: model.id,
                              }
                            : { field: 'modelId', value: model.id },
                        );
                      }}
                    >
                      <span className="dvx-model-name">{modelLabel}</span>
                      {/* Grey effort suffix riding the name (Cursor's
                          one-line "Fable 5 Extra High" readout). */}
                      {isSelected ? (
                        <span className="dvx-model-effort-suffix">
                          {isSpecView && scopedReasoning === undefined
                            ? 'Default'
                            : formatReasoningLabel(scopedReasoning)}
                        </span>
                      ) : null}
                    </button>
                    {/* Pencil and check form one trailing action pair
                        at the right edge (spec §5.1 row anatomy). */}
                    {isSelected ? (
                      <>
                        <button
                          type="button"
                          className="dvx-model-edit"
                          aria-label={`Edit reasoning for ${modelLabel}`}
                          disabled={
                            disabled ||
                            model.supportedReasoningEfforts.length === 0
                          }
                          onClick={() => setEditingReasoning(true)}
                        >
                          <PencilIcon />
                        </button>
                        <CheckIcon className="dvx-model-check" />
                      </>
                    ) : null}
                  </div>
                );
              })}
              {filtered.length === 0 ? (
                <p className="dvx-popover-message">
                  {modelCatalog.items.length === 0
                    ? 'No BYOK models available.'
                    : 'No matching BYOK models.'}
                </p>
              ) : null}
            </div>
          </div>
          {!isSpecView ? (
            <button
              type="button"
              className="dvx-model-spec-row"
              aria-label="Spec drafting"
              disabled={disabled}
              onClick={() => goToView('spec')}
            >
              <span className="dvx-model-spec-row-label">Spec drafting</span>
              <span className="dvx-model-spec-row-right">
                <span className="dvx-model-spec-row-value">
                  {specModelOverrideId === null
                    ? 'Session'
                    : getModelName(specModelOverrideId, modelCatalog)}
                </span>
                <ChevronDownIcon />
              </span>
            </button>
          ) : null}
        </>
      ) : (
        <ModelCatalogStatus
          modelCatalog={modelCatalog}
          current={confirmed}
        />
      )}
      <AddModelEntry onOpen={onManageModels} />
      <SettingsStatus settings={settings} />
      {disabled && settings.status === 'ready' ? (
        <p className="dvx-popover-message" role="status">
          Model settings can be changed after the current turn.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Fixed foot row of the ModelPopover: closes the popover (onOpen)
 * and opens the full-page model manager through the flow context
 * (spec §6 拍板 — a page, not an in-popover panel). The mounted page
 * performs the on-entry refresh, so this click never races it.
 */
export function AddModelEntry({
  onOpen,
}: {
  readonly onOpen: () => void;
}): React.JSX.Element | null {
  const flow = useContext(CustomModelsContext);
  if (flow === null) {
    return null;
  }
  return (
    <button
      type="button"
      className="dvx-model-add-row"
      onClick={() => {
        onOpen();
        flow.onOpenManager();
      }}
    >
      Add models
    </button>
  );
}

function ReasoningEditor({
  model,
  current,
  disabled,
  defaultOptionLabel,
  onSelect,
}: {
  readonly model: ModelCatalogItem;
  readonly current?: SessionReasoningEffort;
  readonly disabled: boolean;
  /** When set, offers a null reset row (used by the spec scope). */
  readonly defaultOptionLabel?: string;
  readonly onSelect: (effort: SessionReasoningEffort | null) => void;
}): React.JSX.Element {
  return (
    <>
      <h3 className="dvx-reasoning-heading">
        Effort
      </h3>
      <div className="dvx-option-list" role="radiogroup" aria-label="Reasoning">
        {defaultOptionLabel !== undefined ? (
          <button
            type="button"
            className="dvx-option-row dvx-reasoning-option"
            role="radio"
            aria-checked={current === undefined}
            disabled={disabled}
            onClick={() => onSelect(null)}
          >
            <span className="dvx-reasoning-label">{defaultOptionLabel}</span>
            {current === undefined ? (
              <CheckIcon className="dvx-model-check" />
            ) : null}
          </button>
        ) : null}
        {model.supportedReasoningEfforts.map((effort) => (
          <button
            key={effort}
            type="button"
            className="dvx-option-row dvx-reasoning-option"
            role="radio"
            aria-checked={effort === current}
            disabled={disabled}
            onClick={() => onSelect(effort)}
          >
            <span className="dvx-reasoning-label">
              {formatReasoningLabel(effort)}
            </span>
            {effort === current ? (
              <CheckIcon className="dvx-model-check" />
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}

function ModelCatalogStatus({
  modelCatalog,
  current,
}: {
  readonly modelCatalog: Exclude<ModelCatalogState, { status: 'ready' }>;
  readonly current: ConfirmedSessionSettings | null;
}): React.JSX.Element {
  const message =
    modelCatalog.status === 'loading'
      ? 'Loading available models…'
      : modelCatalog.message;
  return (
    <>
      <div className="dvx-popover-heading">
        <strong>Current model</strong>
      </div>
      {current !== null ? (
        <dl className="dvx-current-model">
          <Stat label="Model" value={formatModelId(current.modelId)} />
          <Stat
            label="Reasoning"
            value={formatReasoningLabel(current.reasoningEffort)}
          />
        </dl>
      ) : null}
      <p
        className={`dvx-popover-message ${
          modelCatalog.status === 'error' ? 'dvx-error-text' : ''
        }`}
        role={modelCatalog.status === 'error' ? 'alert' : 'status'}
      >
        {message}
      </p>
    </>
  );
}

export function getModelName(
  modelId: string | undefined,
  catalog: ModelCatalogState,
): string {
  if (modelId === undefined) {
    return 'Model';
  }
  if (catalog.status !== 'ready') {
    return formatRawModelId(modelId);
  }
  return catalog.items.find((model) => model.id === modelId)?.displayName ??
    formatRawModelId(modelId);
}

function formatRawModelId(modelId: string): string {
  return modelId.replace(/^custom:/i, '').split('/').at(-1) || modelId;
}

function formatModelId(modelId: string): string {
  const finalSegment = modelId
    .replace(/^custom:/i, '')
    .split('/')
    .at(-1);
  if (finalSegment === undefined || finalSegment.length === 0) {
    return modelId;
  }
  return finalSegment
    .split(/[-_]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (/^gpt(?:\d|$)/i.test(segment)) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toLocaleUpperCase() + segment.slice(1);
    })
    .join(' ')
    .replace(/^GPT (?=\d)/, 'GPT-');
}

function PencilIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-pencil-icon"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3 10.75.55-2.25 5.9-5.9a.85.85 0 0 1 1.2 0l.75.75a.85.85 0 0 1 0 1.2l-5.9 5.9-2.25.55a.2.2 0 0 1-.25-.25Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon({
  className,
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.75 8.5 3 3 5.5-6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronLeftIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-chevron-left"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m9.5 4.5-3.5 3.5 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
