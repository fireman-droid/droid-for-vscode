// Composer control row: the `+` / context / mode / model triggers and
// their popover open/close machinery. The popovers themselves live in
// ./composer/* (structure-only split, one module per responsibility);
// this file re-exports the public surface so import sites are stable.

import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import type {
  ModelCatalogState,
  SessionContextState,
  SessionSettingsState,
} from '../../shared/bridgeMessages';
import type { SessionTokenUsageState } from '../../shared/tokenUsage';
import {
  useOptimisticSettingPick,
  type SessionSettingSelection,
} from './useOptimisticSetting';
import {
  ContextPopover,
  getContextLabel,
  getContextPercent,
  hasUsableContextRatio,
} from './composer/ContextPopover';
import { ModePopover } from './composer/ModePopover';
import { ModelPopover, getModelName } from './composer/ModelPopover';
import { SettingsPopover } from './composer/SettingsPopover';
import {
  ChevronDownIcon,
  MODE_OPTIONS,
  formatReasoningLabel,
  type ComposerNavRequest,
  type McpAuthProgress,
  type McpPanelState,
  type McpServerAddParams,
  type PluginsPanelState,
  type SettingsView,
  type SkillsPanelState,
} from './composer/shared';

export type {
  ComposerNavRequest,
  McpAuthProgress,
  McpPanelState,
  McpServerAddParams,
  PluginsPanelState,
  SkillsPanelState,
} from './composer/shared';
export { rankNameMatches } from './composer/SettingsPopover';
export type { SessionSettingSelection } from './useOptimisticSetting';

type OpenPanel =
  | 'settings'
  | 'context'
  | 'model'
  | 'mode'
  | null;

interface ComposerControlsProps {
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  /**
   * Session/turn token breakdown for the context popover. Optional:
   * the edit card omits the context surface entirely, and when both
   * scopes are null the popover section does not render (fail quiet).
   */
  readonly tokenUsage?: SessionTokenUsageState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly plugins: PluginsPanelState;
  readonly disabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  /** Hides the `+` settings/attachment trigger in historical editors. */
  readonly showSessionControls?: boolean;
  /** Hides the context ring + popover (the edit card omits them). */
  readonly showContext?: boolean;
  /** A compaction request is in flight; the compact button shows an
   * in-progress state and ignores further clicks. */
  readonly compactPending?: boolean;
  readonly onContextRefresh: () => void;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly missionActive?: boolean;
  readonly onMissionOpen?: () => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onPluginsRefresh: () => void;
  /** Latest slash-command navigation request; null before the first. */
  readonly navSignal?: ComposerNavRequest | null;
  /** Starts a fresh session (skills apply at session start). */
  readonly onNewSession?: () => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
}

/**
 * Tallest popover (model list) plus its offset; when less than this
 * fits above the control row, opening upward would clip off screen.
 */
const POPOVER_SPACE_PX = 340;

/**
 * How long a dismissed popover stays mounted so its dvx-rise-out
 * exit (--dvx-duration-normal, 150ms) finishes before unmount.
 */
const POPOVER_EXIT_MS = 190;

/**
 * Whether control-row popovers should open downward: the space above
 * cannot fit a popover and there is more room below. The bottom
 * composer keeps its upward default; a pinned edit card flips down.
 */
export function shouldOpenPopoverDown(
  spaceAbove: number,
  spaceBelow: number,
): boolean {
  return spaceAbove < POPOVER_SPACE_PX && spaceBelow > spaceAbove;
}

export function ComposerControls({
  settings,
  context,
  tokenUsage,
  modelCatalog,
  skills,
  mcp,
  plugins,
  disabled,
  settingUpdatesDisabled,
  showSessionControls = true,
  showContext = true,
  compactPending = false,
  onContextRefresh,
  onCompact,
  onSettingUpdate,
  missionActive = false,
  onMissionOpen,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  onMcpServerAdd,
  onMcpServerRemove,
  mcpAuth,
  onMcpServerAuthenticate,
  onPluginsRefresh,
  navSignal = null,
  onNewSession,
  onAttachFiles,
  onAttachEditor,
  onAttachSelection,
  onAttachProblems,
  onAttachGitChanges,
}: ComposerControlsProps): React.JSX.Element {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [settingsView, setSettingsView] = useState<SettingsView>('root');
  const controlsRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const confirmed = settings.value;
  const updating = settings.status === 'updating';
  const settingControlsDisabled =
    disabled || settingUpdatesDisabled || confirmed === null || updating;
  // Optimistic trigger labels (useOptimisticSetting.ts): a picked
  // mode/model shows immediately; the settled frame reconciles.
  const { shownMode, shownModelId, pickSetting } =
    useOptimisticSettingPick(settings, onSettingUpdate);
  const displayedMode = missionActive ? 'mission' : shownMode;
  // While Spec mode has an active drafting-model override, the
  // trigger reflects it instead of the session model (2026-08-16
  // redesign) — otherwise a working override was invisible outside
  // the popover. Not optimistic: specModeModelId picks settle like
  // the existing reasoning-effort readout below already does.
  const specOverrideModelId =
    confirmed?.interactionMode === 'spec' ? confirmed.specModeModelId : null;
  const modelName = getModelName(
    specOverrideModelId ?? shownModelId,
    modelCatalog,
  );
  const triggerReasoning =
    specOverrideModelId !== null
      ? (confirmed?.specModeReasoningEffort ?? undefined)
      : confirmed?.reasoningEffort;
  const contextPercent = getContextPercent(context);
  const showContextPercent =
    context.value !== null && hasUsableContextRatio(context.value);
  const modeLabel =
    MODE_OPTIONS.find((option) => option.value === displayedMode)?.label ??
    'Mode';

  // A dismissed popover stays mounted as closingPanel while its exit
  // animation plays; the view resets to root only after unmount so
  // the fading panel does not visibly swap content.
  const [closingPanel, setClosingPanel] = useState<OpenPanel>(null);
  const closeTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );
  const close = (): void => {
    if (openPanel === null) {
      return;
    }
    setClosingPanel(openPanel);
    setOpenPanel(null);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setClosingPanel(null);
      setSettingsView('root');
    }, POPOVER_EXIT_MS);
  };

  useEffect(() => {
    if (openPanel === null) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !controlsRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
    // close only reads openPanel, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPanel]);

  const [openDown, setOpenDown] = useState(false);
  // Each open remounts the popover component (fresh search/view
  // state) even when it reopens while the previous instance is still
  // mounted playing its exit animation.
  const [openSeq, setOpenSeq] = useState(0);
  const open = (panel: Exclude<OpenPanel, null>): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosingPanel(null);
    setOpenPanel(panel);
    setOpenSeq((sequence) => sequence + 1);
    setSettingsView('root');
    // Popovers default to opening upward (bottom composer); when the
    // controls sit near the viewport top (pinned edit card) that would
    // push them off screen, so flip downward instead.
    const rect = controlsRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setOpenDown(
        shouldOpenPopoverDown(rect.top, window.innerHeight - rect.bottom),
      );
    }
  };
  const toggle = (panel: Exclude<OpenPanel, null>): void => {
    if (openPanel === panel) {
      close();
      return;
    }
    open(panel);
  };

  // `/model` `/context` `/mcp` `/skills` (typed or picked in the `/`
  // popup) open the same popovers the control buttons do, under the
  // same availability guards as those buttons.
  const lastNavIdRef = useRef(0);
  useEffect(() => {
    if (navSignal === null || navSignal.id === lastNavIdRef.current) {
      return;
    }
    lastNavIdRef.current = navSignal.id;
    if (disabled) {
      return;
    }
    if (navSignal.target === 'model') {
      if (confirmed !== null) {
        open('model');
      }
      return;
    }
    if (navSignal.target === 'context') {
      if (showContext) {
        open('context');
      }
      return;
    }
    // Skills / MCP live as views inside the `+` settings popover;
    // entering re-reads the catalog like the in-panel links do.
    open('settings');
    if (navSignal.target === 'skills') {
      onSkillsRefresh();
    } else {
      onMcpRefresh();
    }
    setSettingsView(navSignal.target);
    // Reacts to new nav requests only; the handlers and guards it
    // reads are stable within one render of that request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSignal]);
  const renderedPanel = openPanel ?? closingPanel;

  return (
    <div
      className={`dvx-composer-controls${
        openDown ? ' dvx-controls-down' : ''
      }`}
      data-popover-closing={
        openPanel === null && closingPanel !== null ? '' : undefined
      }
      ref={controlsRef}
    >
      {showSessionControls || showContext ? (
        <div className="dvx-composer-control-left">
          {showSessionControls ? (
            <button
              type="button"
              className="dvx-composer-tool-button dvx-plus-button"
              aria-label="Session controls"
              aria-expanded={openPanel === 'settings'}
              aria-controls={
                openPanel === 'settings' ? `${panelId}-settings` : undefined
              }
              disabled={disabled}
              onClick={() => toggle('settings')}
            >
              <span aria-hidden="true">+</span>
            </button>
          ) : null}
          {showContext ? (
            <button
              type="button"
              className="dvx-composer-tool-button dvx-context-button"
              aria-label={getContextLabel(context)}
              aria-expanded={openPanel === 'context'}
              aria-controls={
                openPanel === 'context' ? `${panelId}-context` : undefined
              }
              disabled={disabled}
              onClick={() => toggle('context')}
            >
              <svg
                className="dvx-context-ring"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="dvx-context-ring-track"
                  cx="12"
                  cy="12"
                  r="9"
                />
                <circle
                  className="dvx-context-ring-value"
                  cx="12"
                  cy="12"
                  r="9"
                  pathLength="100"
                  strokeDasharray={`${contextPercent} 100`}
                />
              </svg>
              {showContextPercent ? (
                <span className="dvx-context-percent" aria-hidden="true">
                  {Math.round(contextPercent)}%
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className={`dvx-mode-trigger${
          displayedMode === 'spec' ? ' dvx-mode-trigger-spec' : ''
        }`}
        aria-label={`Mode: ${modeLabel}`}
        aria-expanded={openPanel === 'mode'}
        aria-controls={openPanel === 'mode' ? `${panelId}-mode` : undefined}
        disabled={disabled || confirmed === null}
        onClick={() => toggle('mode')}
      >
        <span>{modeLabel}</span>
        <ChevronDownIcon />
      </button>

      <button
        type="button"
        className="dvx-model-trigger"
        aria-label={`Model: ${modelName}`}
        title={specOverrideModelId ?? confirmed?.modelId}
        aria-expanded={openPanel === 'model'}
        aria-controls={
          openPanel === 'model' ? `${panelId}-model` : undefined
        }
        disabled={disabled || confirmed === null}
        onClick={() => toggle('model')}
      >
        <span>{modelName}</span>
        {/* Cursor-style "Fable 5 Max" readout (2026-08-13). */}
        {triggerReasoning !== undefined ? (
          <span className="dvx-model-trigger-effort" aria-hidden="true">
            {formatReasoningLabel(triggerReasoning)}
          </span>
        ) : null}
        {specOverrideModelId !== null ? (
          <span className="dvx-model-trigger-scope" aria-hidden="true">
            spec
          </span>
        ) : null}
        <ChevronDownIcon />
      </button>

      {renderedPanel === 'settings' ? (
        <SettingsPopover
          key={openSeq}
          id={`${panelId}-settings`}
          view={settingsView}
          settings={settings}
          skills={skills}
          mcp={mcp}
          plugins={plugins}
          disabled={settingControlsDisabled}
          attachDisabled={disabled}
          onViewChange={setSettingsView}
          onUpdate={pickSetting}
          onSkillsRefresh={onSkillsRefresh}
          onSkillToggle={onSkillToggle}
          onMcpRefresh={onMcpRefresh}
          onMcpServerToggle={onMcpServerToggle}
          onMcpServerAdd={onMcpServerAdd}
          onMcpServerRemove={onMcpServerRemove}
          mcpAuth={mcpAuth}
          onMcpServerAuthenticate={onMcpServerAuthenticate}
          onPluginsRefresh={onPluginsRefresh}
          onNewSession={onNewSession}
          onAttach={(source) => {
            close();
            if (source === 'files') {
              onAttachFiles();
            } else if (source === 'editor') {
              onAttachEditor();
            } else if (source === 'selection') {
              onAttachSelection();
            } else if (source === 'problems') {
              onAttachProblems();
            } else {
              onAttachGitChanges();
            }
          }}
        />
      ) : null}
      {renderedPanel === 'context' ? (
        <ContextPopover
          key={openSeq}
          id={`${panelId}-context`}
          context={context}
          tokenUsage={tokenUsage}
          disabled={disabled || context.status === 'loading'}
          compactPending={compactPending}
          onRefresh={onContextRefresh}
          onCompact={onCompact}
          onClose={close}
        />
      ) : null}
      {renderedPanel === 'mode' && confirmed !== null ? (
        <ModePopover
          id={`${panelId}-mode`}
          settings={settings}
          shownMode={displayedMode ?? confirmed.interactionMode}
          disabled={settingControlsDisabled}
          onSelect={(value) => {
            close();
            if (value === 'mission') {
              onMissionOpen?.();
              return;
            }
            if (value !== confirmed.interactionMode) {
              pickSetting({
                field: 'interactionMode',
                value,
              });
            }
          }}
        />
      ) : null}
      {renderedPanel === 'model' && confirmed !== null ? (
        <ModelPopover
          key={openSeq}
          id={`${panelId}-model`}
          settings={settings}
          modelCatalog={modelCatalog}
          disabled={settingControlsDisabled}
          onUpdate={(update) => {
            pickSetting(update);
            close();
          }}
          // The Add-models row swaps the whole view for the model
          // manager page (spec §6 拍板); the popover just closes.
          onManageModels={close}
        />
      ) : null}
    </div>
  );
}
