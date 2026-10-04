import { useContext, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { RadioGroup, RadioGroupItem } from '../../ui/controls';

import {
  type ConfirmedSessionSettings,
  type ModelCatalogItem,
  type ModelCatalogState,
  type SessionReasoningEffort,
  type SessionSettingsState,
} from '../../../shared/protocol/settings';
import { CustomModelsContext } from '../../models/customModelsFlow';
import { ModelSourceControl, ModelSourceEmpty, ModelSourceNotice, useModelSource } from '../../models/ModelSourceControl';
import { matchesModelSource } from '../../../shared/protocol/modelSourceProtocol';
import type { SessionSettingSelection } from './useOptimisticSetting';
import { ChevronDownIcon, SettingsStatus, Stat, formatReasoningLabel } from './shared';

type ModelPopoverProps = {
  readonly id: string;
  readonly modelCatalog: ModelCatalogState;
  readonly disabled: boolean;
  readonly refreshDisabled?: boolean;
  readonly onRefresh?: () => void;
  readonly onUpdate: (
    update: Extract<
      SessionSettingSelection,
      {
        field:
          | 'modelId'
          | 'reasoningEffort'
          | 'specModeModelId'
          | 'specModeReasoningEffort';
      }
    >,
  ) => void;
  /** Closes the popover; the entry row itself opens the manager page. */
  readonly onManageModels: () => void;
  readonly onOpenModels?: () => void;
} & (
  | { readonly settings: SessionSettingsState; readonly selection?: never }
  | { readonly settings?: never; readonly selection: {
    readonly modelId: string | undefined;
    readonly reasoningEffort: SessionReasoningEffort | undefined;
  } }
);

export function ModelPopover({
  id, settings, selection, modelCatalog, disabled, refreshDisabled = disabled,
  onRefresh, onUpdate, onManageModels, onOpenModels,
}: ModelPopoverProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [editingReasoning, setEditingReasoning] = useState(false);
  const [view, setView] = useState<'root' | 'spec'>('root');
  const { mode: sourceMode } = useModelSource();
  const confirmed = settings?.value;
  const isSpecView = settings !== undefined && view === 'spec';
  const specModelOverrideId = confirmed?.specModeModelId ?? null;
  // An unset drafting model inherits the session model; "Same as
  // session" carries that state on its own row, so a model row only
  // checks when specModeModelId names it explicitly (no double tick).
  const effectiveModelId = isSpecView
    ? (specModelOverrideId ?? confirmed?.modelId)
    : selection?.modelId ?? confirmed?.modelId;
  const rowMatchId = isSpecView ? (specModelOverrideId ?? undefined) : effectiveModelId;
  const scopedReasoning = isSpecView
    ? (confirmed?.specModeReasoningEffort ?? undefined)
    : selection?.reasoningEffort ?? confirmed?.reasoningEffort;
  const usesSessionModel = isSpecView && specModelOverrideId === null;
  const selected =
    modelCatalog.status !== 'ready'
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
    return modelCatalog.items.filter(
      (model) =>
        matchesModelSource(model, sourceMode) &&
        (model.displayName.toLocaleLowerCase().includes(normalized) ||
        model.id.toLocaleLowerCase().includes(normalized)),
    );
  }, [modelCatalog, query, sourceMode]);

  const selectEffort = (effort: SessionReasoningEffort | null): void => {
    if (isSpecView) onUpdate({ field: 'specModeReasoningEffort', value: effort });
    else if (effort !== null) onUpdate({ field: 'reasoningEffort', value: effort });
  };

  if (editingReasoning && selected !== undefined) {
    return (
      <div
        id={id}
        className="dvx-composer-popover dvx-model-popover"
        role="dialog"
        aria-label="Reasoning effort"
      >
        <div className="dvx-model-panel">
          <div className="dvx-panel-head">
            <Button variant="plain" size="none"
              type="button"
              className="dvx-panel-back"
              autoFocus
              onClick={() => setEditingReasoning(false)}
            >
              <ChevronLeftIcon />
              <span className="dvx-panel-title">Back to models</span>
            </Button>
          </div>
          <div className="dvx-reasoning-flyout">
            <ReasoningEditor
              model={selected}
              current={scopedReasoning}
              disabled={disabled || selected.disabled}
              {...(isSpecView ? { defaultOptionLabel: 'Model default' } : {})}
              onSelect={selectEffort}
            />
          </div>
          {settings !== undefined ? <SettingsStatus settings={settings} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-model-popover"
      role="dialog"
      aria-label={isSpecView ? 'Spec drafting model' : 'Model'}
      aria-busy={modelCatalog.status === 'loading'}
    >
      {modelCatalog.status === 'ready' ? (
        <>
          <div className="dvx-model-panel">
            {isSpecView ? (
              <div className="dvx-panel-head">
                <Button variant="plain" size="none"
                  type="button"
                  className="dvx-panel-back"
                  aria-label="Back to model"
                  onClick={() => goToView('root')}
                >
                  <ChevronLeftIcon />
                  <span className="dvx-panel-title">Spec drafting</span>
                </Button>
              </div>
            ) : null}
            <div className="space-y-2 px-2 pt-2">
              <ModelSourceControl models={modelCatalog.items} />
              <ModelSourceNotice model={selected} />
            </div>
            <label className="dvx-visually-hidden" htmlFor={`${id}-search`}>
              Search models
            </label>
            <div className="dvx-model-search-shell">
              <Search aria-hidden="true" />
              <Input
                id={`${id}-search`}
                className="dvx-model-search h-9 rounded-none border-0 bg-transparent p-0 text-[13px] focus-visible:border-transparent"
                type="search"
                autoFocus
                value={query}
                placeholder="Search models"
                autoComplete="off"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <div
              className="dvx-model-list"
              role="list"
              aria-label={isSpecView ? 'Spec drafting models' : 'Available models'}
            >
              {isSpecView ? (
                <>
                  <div
                    className="dvx-model-row"
                    role="listitem"
                    aria-current={usesSessionModel ? 'true' : undefined}
                  >
                    <Button variant="plain" size="none"
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
                    </Button>
                    {usesSessionModel ? (
                      <>
                        <Button variant="plain" size="none"
                          type="button"
                          className="dvx-model-edit"
                          aria-label="Edit reasoning for the session model"
                          disabled={
                            disabled ||
                            selected === undefined ||
                            selected.disabled ||
                            selected.supportedReasoningEfforts.length === 0
                          }
                          onClick={() => setEditingReasoning(true)}
                        >
                          <PencilIcon />
                        </Button>
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
                    <Button variant="plain" size="none"
                      type="button"
                      className="dvx-model-choice"
                      aria-label={`${model.displayName}, ${model.id}`}
                      title={model.id}
                      disabled={disabled || model.disabled}
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
                      {isSelected ? (
                        <span className="dvx-model-effort-suffix">
                          {isSpecView && scopedReasoning === undefined
                            ? 'Default'
                            : formatReasoningLabel(scopedReasoning)}
                        </span>
                      ) : null}
                      <span className="basis-full text-[11px] leading-4 text-muted-foreground">
                        {model.isCustom ? 'BYOK' : '官方'} · {model.supportsImages ? 'Images' : 'Text only'}
                        {model.supportsImageGeneration ? ' · Image generation' : ''}
                      </span>
                      {model.disabled ? <span className="basis-full break-words text-[11px] leading-4">{model.disabledReason}</span> : null}
                    </Button>
                    {isSelected ? (
                      <>
                        <Button variant="plain" size="none"
                          type="button"
                          className="dvx-model-edit"
                          aria-label={`Edit reasoning for ${modelLabel}`}
                          disabled={
                            disabled || model.disabled || model.supportedReasoningEfforts.length === 0
                          }
                          onClick={() => setEditingReasoning(true)}
                        >
                          <PencilIcon />
                        </Button>
                        <CheckIcon className="dvx-model-check" />
                      </>
                    ) : null}
                  </div>
                );
              })}
              {filtered.length === 0 ? <ModelSourceEmpty /> : null}
            </div>
          </div>
          {settings !== undefined && !isSpecView ? (
            <Button variant="plain" size="none"
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
            </Button>
          ) : null}
        </>
      ) : (
        <ModelCatalogStatus modelCatalog={modelCatalog} current={confirmed ?? null}
          disabled={refreshDisabled} onRefresh={onRefresh} />
      )}
      <AddModelEntry onOpen={onManageModels} onOpenModels={onOpenModels} />
      {settings !== undefined ? <SettingsStatus settings={settings} /> : null}
      {disabled && settings?.status === 'ready' ? (
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
  onOpenModels,
}: {
  readonly onOpen: () => void;
  readonly onOpenModels?: () => void;
}): React.JSX.Element | null {
  const flow = useContext(CustomModelsContext);
  const openManager = onOpenModels ?? flow?.onOpenManager;
  if (openManager === undefined) {
    return null;
  }
  return (
    <Button variant="plain" size="none"
      type="button"
      className="dvx-model-add-row"
      onClick={() => {
        onOpen();
        openManager();
      }}
    >
      <Plus aria-hidden="true" /><span>Add models</span>
    </Button>
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
      <h3 className="dvx-reasoning-heading">Reasoning effort</h3>
      <RadioGroup className="dvx-option-list" aria-label="Reasoning" disabled={disabled}
        value={current ?? 'default'} onValueChange={(value) => onSelect(value === 'default' ? null : value as SessionReasoningEffort)}>
        {defaultOptionLabel !== undefined ? (
          <label
            className="dvx-option-row dvx-reasoning-option"
          >
            <span className="dvx-reasoning-label">{defaultOptionLabel}</span>
            <RadioGroupItem value="default" aria-label={defaultOptionLabel} />
          </label>
        ) : null}
        {model.supportedReasoningEfforts.map((effort) => (
          <label
            key={effort}
            className="dvx-option-row dvx-reasoning-option"
          >
            <span className="dvx-reasoning-label">{formatReasoningLabel(effort)}{effort === model.defaultReasoningEffort ? ' (default)' : ''}</span>
            <RadioGroupItem value={effort} aria-label={formatReasoningLabel(effort)} />
          </label>
        ))}
      </RadioGroup>
    </>
  );
}

function ModelCatalogStatus({
  modelCatalog,
  current,
  disabled,
  onRefresh,
}: {
  readonly modelCatalog: Exclude<ModelCatalogState, { status: 'ready' }>;
  readonly current: ConfirmedSessionSettings | null;
  readonly disabled: boolean;
  readonly onRefresh?: () => void;
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
          <Stat label="Reasoning" value={formatReasoningLabel(current.reasoningEffort)} />
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
      {onRefresh !== undefined ? (
        <Button variant="ghost" size="sm" className="mx-2 mb-2"
          disabled={disabled || modelCatalog.status === 'loading'}
          onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          Retry models
        </Button>
      ) : null}
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
  return (
    catalog.items.find((model) => model.id === modelId)?.displayName ??
    formatRawModelId(modelId)
  );
}

function formatRawModelId(modelId: string): string {
  return (
    modelId
      .replace(/^custom:/i, '')
      .split('/')
      .at(-1) || modelId
  );
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
    <svg className="dvx-pencil-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true">
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

function CheckIcon({ className }: { readonly className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
    <svg className="dvx-chevron-left" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
