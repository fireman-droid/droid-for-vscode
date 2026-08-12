import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { MCP_SERVER_TYPES } from '../../shared/bridgeMessages';
import type {
  ConfirmedSessionSettings,
  McpAuthPhase,
  McpServerSummary,
  McpServerType,
  ModelCatalogItem,
  ModelCatalogState,
  SessionAutonomyLevel,
  SessionContextState,
  SessionInteractionMode,
  SessionMcpState,
  SessionPluginsState,
  SessionReasoningEffort,
  SessionSettingUpdateMessage,
  SessionSettingsState,
  SessionSkillsState,
  PluginSummary,
  SkillSummary,
} from '../../shared/bridgeMessages';
import type {
  SessionTokenUsageState,
  TokenUsageBreakdown,
} from '../../shared/tokenUsage';

type OpenPanel = 'settings' | 'context' | 'model' | 'mode' | null;
type SettingsView =
  | 'root'
  | 'mode'
  | 'autonomy'
  | 'skills'
  | 'mcp'
  | 'plugins';

export type SkillsPanelState =
  | SessionSkillsState
  | { readonly status: 'idle'; readonly items: readonly [] };

export type McpPanelState =
  | SessionMcpState
  | { readonly status: 'idle'; readonly items: readonly [] };

export type PluginsPanelState =
  | SessionPluginsState
  | { readonly status: 'idle'; readonly items: readonly [] };

/** Progress of the one in-flight MCP browser authentication flow. */
export interface McpAuthProgress {
  readonly serverName: string;
  readonly phase: McpAuthPhase;
  readonly message: string | null;
}

/** Payload for registering a new MCP server from the MCP panel. */
export interface McpServerAddParams {
  readonly name: string;
  readonly serverType: McpServerType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
}

/**
 * One slash-command navigation request targeting a composer panel
 * (`/model` `/context` `/mcp` `/skills`). The monotonic id lets the
 * same target fire again after the user closed the panel.
 */
export interface ComposerNavRequest {
  readonly id: number;
  readonly target: 'model' | 'context' | 'mcp' | 'skills';
}

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
  /** Hides the context ring + popover (the edit card omits them). */
  readonly showContext?: boolean;
  /** A compaction request is in flight; the compact button shows an
   * in-progress state and ignores further clicks. */
  readonly compactPending?: boolean;
  readonly onContextRefresh: () => void;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
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

export type SessionSettingSelection =
  SessionSettingUpdateMessage extends infer Message
    ? Message extends SessionSettingUpdateMessage
      ? Omit<Message, 'type' | 'sessionId'>
      : never
    : never;

const MODE_OPTIONS: readonly {
  readonly value: SessionInteractionMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Droid chooses the best way to work.',
  },
  {
    value: 'spec',
    label: 'Spec',
    description: 'Plan and confirm the approach first.',
  },
  {
    value: 'mission',
    label: 'Mission',
    description: 'Work toward a defined outcome.',
  },
];

const AUTONOMY_OPTIONS: readonly {
  readonly value: SessionAutonomyLevel;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'off',
    label: 'Off',
    description: 'Ask before taking autonomous steps.',
  },
  {
    value: 'low',
    label: 'Low',
    description: 'Take a small number of safe steps.',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Continue through routine work.',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Proceed broadly within runtime safeguards.',
  },
];

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
  showContext = true,
  compactPending = false,
  onContextRefresh,
  onCompact,
  onSettingUpdate,
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
  const modelName = getModelName(confirmed?.modelId, modelCatalog);
  const contextPercent = getContextPercent(context);
  const showContextPercent =
    context.value !== null && hasUsableContextRatio(context.value);
  const modeLabel =
    MODE_OPTIONS.find(
      (option) => option.value === confirmed?.interactionMode,
    )?.label ?? 'Mode';

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
      <div className="dvx-composer-control-left">
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

      <button
        type="button"
        className={`dvx-mode-trigger${
          confirmed?.interactionMode === 'spec'
            ? ' dvx-mode-trigger-spec'
            : ''
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
        title={confirmed?.modelId}
        aria-expanded={openPanel === 'model'}
        aria-controls={
          openPanel === 'model' ? `${panelId}-model` : undefined
        }
        disabled={disabled || confirmed === null}
        onClick={() => toggle('model')}
      >
        <span>{modelName}</span>
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
          onUpdate={onSettingUpdate}
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
        />
      ) : null}
      {renderedPanel === 'mode' && confirmed !== null ? (
        <div
          id={`${panelId}-mode`}
          className="dvx-composer-popover dvx-mode-popover"
          role="dialog"
          aria-label="Mode"
        >
          <div
            className="dvx-option-list"
            role="radiogroup"
            aria-label="Mode options"
          >
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="dvx-option-row"
                role="radio"
                aria-checked={option.value === confirmed.interactionMode}
                disabled={settingControlsDisabled}
                onClick={() => {
                  close();
                  if (option.value !== confirmed.interactionMode) {
                    onSettingUpdate({
                      field: 'interactionMode',
                      value: option.value,
                    });
                  }
                }}
              >
                <span className="dvx-option-copy">
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </span>
                <span className="dvx-radio-mark" aria-hidden="true" />
              </button>
            ))}
          </div>
          <SettingsStatus settings={settings} />
          {settingControlsDisabled && settings.status === 'ready' ? (
            <p className="dvx-popover-message" role="status">
              Mode can be changed after the current turn.
            </p>
          ) : null}
        </div>
      ) : null}
      {renderedPanel === 'model' && confirmed !== null ? (
        <ModelPopover
          key={openSeq}
          id={`${panelId}-model`}
          settings={settings}
          modelCatalog={modelCatalog}
          disabled={settingControlsDisabled}
          onUpdate={(update) => {
            onSettingUpdate(update);
            close();
          }}
        />
      ) : null}
    </div>
  );
}

type AttachSource =
  | 'files'
  | 'editor'
  | 'selection'
  | 'problems'
  | 'git-changes';

function SettingsPopover({
  id,
  view,
  settings,
  skills,
  mcp,
  plugins,
  disabled,
  attachDisabled,
  onViewChange,
  onUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  onMcpServerAdd,
  onMcpServerRemove,
  mcpAuth,
  onMcpServerAuthenticate,
  onPluginsRefresh,
  onNewSession,
  onAttach,
}: {
  readonly id: string;
  readonly view: SettingsView;
  readonly settings: SessionSettingsState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly plugins: PluginsPanelState;
  readonly disabled: boolean;
  readonly attachDisabled: boolean;
  readonly onViewChange: (view: SettingsView) => void;
  readonly onUpdate: (
    update: Extract<
      SessionSettingSelection,
      { field: 'interactionMode' | 'autonomyLevel' }
    >,
  ) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onPluginsRefresh: () => void;
  readonly onNewSession?: () => void;
  readonly onAttach: (source: AttachSource) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const confirmed = settings.value;
  // The popover stacks the root list and the Skills/MCP/Plugins
  // drill-ins ('mode'/'autonomy' are inline expansions of root).
  // Changing views remounts the keyed wrapper below, which plays a
  // short directional slide: drilling in arrives from the right,
  // going back from the left. The first mount plays neither — the
  // popover itself already animates in.
  const group: 'root' | 'skills' | 'mcp' | 'plugins' =
    view === 'skills' || view === 'mcp' || view === 'plugins'
      ? view
      : 'root';
  const previousGroupRef = useRef(group);
  const directionRef = useRef<'forward' | 'back' | null>(null);
  if (previousGroupRef.current !== group) {
    directionRef.current = group === 'root' ? 'back' : 'forward';
    previousGroupRef.current = group;
  }
  const shell = (
    label: string,
    content: React.JSX.Element,
  ): React.JSX.Element => (
    <div
      id={id}
      className="dvx-composer-popover dvx-settings-popover"
      role="dialog"
      aria-label={label}
    >
      <div
        key={group}
        className="dvx-settings-view"
        data-direction={directionRef.current ?? undefined}
      >
        {content}
      </div>
    </div>
  );
  if (confirmed === null) {
    return shell(
      'Session controls',
      <>
        <AttachRows disabled={attachDisabled} onAttach={onAttach} />
        <div className="dvx-settings-divider" />
        {settings.status === 'error' ? (
          <p className="dvx-popover-message dvx-error-text" role="alert">
            {settings.message}
          </p>
        ) : (
          <p className="dvx-popover-message" role="status">
            Loading session settings…
          </p>
        )}
      </>,
    );
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const showMode =
    normalizedQuery.length === 0 || 'mode'.includes(normalizedQuery);
  const showAutonomy =
    normalizedQuery.length === 0 || 'autonomy'.includes(normalizedQuery);
  const showSkills =
    normalizedQuery.length === 0 || 'skills'.includes(normalizedQuery);
  const showMcp =
    normalizedQuery.length === 0 || 'mcp servers'.includes(normalizedQuery);
  const showPlugins =
    normalizedQuery.length === 0 || 'plugins'.includes(normalizedQuery);
  const showAttach =
    normalizedQuery.length === 0 ||
    'attach files editor selection context'.includes(normalizedQuery);
  // Real catalog entries also answer the search, so typing a skill or
  // server name surfaces it directly instead of only the static rows.
  // Matching is name-only (Cursor behavior): description hits pulled
  // in unrelated entries (searching "figma" surfaced agent-browser
  // because its description mentions Figma) with no visible reason.
  const matchedSkills =
    normalizedQuery.length === 0
      ? []
      : rankNameMatches(skills.items, normalizedQuery, 5);
  const matchedServers =
    normalizedQuery.length === 0
      ? []
      : rankNameMatches(mcp.items, normalizedQuery, 5);

  if (view === 'skills') {
    return shell(
      'Skills',
        <SkillsPanel
          skills={skills}
          disabled={disabled}
          onBack={() => onViewChange('root')}
          onRefresh={onSkillsRefresh}
          onToggle={onSkillToggle}
          // Starting a new session leaves the old catalog behind;
          // return to the root controls so the popover tracks the new
          // session instead of a stale skills list.
          onNewSession={
            onNewSession === undefined
              ? undefined
              : () => {
                  onNewSession();
                  onViewChange('root');
                }
          }
        />,
    );
  }

  if (view === 'mcp') {
    return shell(
      'MCP servers',
      <McpPanel
        mcp={mcp}
        auth={mcpAuth}
        disabled={disabled}
        onBack={() => onViewChange('root')}
        onRefresh={onMcpRefresh}
        onToggle={onMcpServerToggle}
        onAdd={onMcpServerAdd}
        onRemove={onMcpServerRemove}
        onAuthenticate={onMcpServerAuthenticate}
      />,
    );
  }

  if (view === 'plugins') {
    return shell(
      'Plugins',
      <PluginsPanel
        plugins={plugins}
        onBack={() => onViewChange('root')}
        onRefresh={onPluginsRefresh}
      />,
    );
  }

  return shell(
    'Session controls',
    <>
      <label className="dvx-visually-hidden" htmlFor={`${id}-action-search`}>
        Search actions
      </label>
      <div className="dvx-settings-search-shell">
        <SearchIcon />
        <input
          id={`${id}-action-search`}
          className="dvx-settings-search"
          type="search"
          value={query}
          placeholder="Search actions, skills, MCP…"
          autoComplete="off"
          onChange={(event) => {
            const next = event.currentTarget.value;
            setQuery(next);
            onViewChange('root');
            // Load the real catalogs the first time a search needs them.
            if (next.trim().length > 0) {
              if (skills.status === 'idle') {
                onSkillsRefresh();
              }
              if (mcp.status === 'idle') {
                onMcpRefresh();
              }
            }
          }}
        />
      </div>
      {showAttach ? (
        <>
          <AttachRows disabled={attachDisabled} onAttach={onAttach} />
          <div className="dvx-settings-divider" />
        </>
      ) : null}
      {showMode ? (
        <SettingsDropdown
          id={`${id}-mode`}
          title="Mode"
          expanded={view === 'mode'}
          current={confirmed.interactionMode}
          options={MODE_OPTIONS}
          disabled={disabled}
          onToggle={() =>
            onViewChange(view === 'mode' ? 'root' : 'mode')
          }
          onSelect={(value) => {
            onViewChange('root');
            if (value !== confirmed.interactionMode) {
              onUpdate({ field: 'interactionMode', value });
            }
          }}
        />
      ) : null}
      {showAutonomy ? (
        <SettingsDropdown
          id={`${id}-autonomy`}
          title="Autonomy"
          expanded={view === 'autonomy'}
          current={confirmed.autonomyLevel}
          options={AUTONOMY_OPTIONS}
          disabled={disabled}
          onToggle={() =>
            onViewChange(view === 'autonomy' ? 'root' : 'autonomy')
          }
          onSelect={(value) => {
            onViewChange('root');
            if (value !== confirmed.autonomyLevel) {
              onUpdate({ field: 'autonomyLevel', value });
            }
          }}
        />
      ) : null}
      {showSkills || showMcp ? <div className="dvx-settings-divider" /> : null}
      {showSkills ? (
        <button
          type="button"
          className="dvx-popover-row dvx-settings-link-row"
          onClick={() => {
            // Always re-read on entry so the panel reflects config
            // changes made outside this popover.
            onSkillsRefresh();
            onViewChange('skills');
          }}
        >
          <SettingsInfoIcon kind="skills" />
          <span className="dvx-popover-row-copy">
            <strong>Skills</strong>
          </span>
          <span className="dvx-popover-row-value">
            {skills.status === 'ready'
              ? `${skills.items.filter((skill) => skill.enabled).length}/${
                  skills.items.length
                } on`
              : ''}
          </span>
          <ChevronDownIcon />
        </button>
      ) : null}
      {showMcp ? (
        <button
          type="button"
          className="dvx-popover-row dvx-settings-link-row"
          onClick={() => {
            onMcpRefresh();
            onViewChange('mcp');
          }}
        >
          <SettingsInfoIcon kind="mcp" />
          <span className="dvx-popover-row-copy">
            <strong>MCP servers</strong>
          </span>
          <span className="dvx-popover-row-value">
            {mcp.status === 'ready'
              ? `${mcp.items.filter(
                  (server) => server.status !== 'disabled',
                ).length}/${mcp.items.length} on`
              : ''}
          </span>
          <ChevronDownIcon />
        </button>
      ) : null}
      {showPlugins ? (
        <button
          type="button"
          className="dvx-popover-row dvx-settings-link-row"
          onClick={() => {
            // Always re-read on entry so the panel reflects installs
            // made with the droid CLI while this popover was closed.
            onPluginsRefresh();
            onViewChange('plugins');
          }}
        >
          <SettingsInfoIcon kind="plugins" />
          <span className="dvx-popover-row-copy">
            <strong>Plugins</strong>
          </span>
          <span className="dvx-popover-row-value">
            {plugins.status === 'ready'
              ? `${plugins.items.length} installed`
              : ''}
          </span>
          <ChevronDownIcon />
        </button>
      ) : null}
      {matchedSkills.length > 0 || matchedServers.length > 0 ? (
        <>
          <div className="dvx-settings-divider" />
          {matchedSkills.map((skill) => (
            <button
              key={`skill:${skill.name}`}
              type="button"
              className="dvx-popover-row dvx-settings-link-row"
              onClick={() => {
                onSkillsRefresh();
                onViewChange('skills');
              }}
            >
              <SettingsInfoIcon kind="skills" />
              <span className="dvx-popover-row-copy">
                <strong>{skill.name}</strong>
                {skill.description !== null ? (
                  <span>{skill.description}</span>
                ) : null}
              </span>
              <span className="dvx-popover-row-value">Skill</span>
            </button>
          ))}
          {matchedServers.map((server) => (
            <button
              key={`mcp:${server.name}`}
              type="button"
              className="dvx-popover-row dvx-settings-link-row"
              onClick={() => {
                onMcpRefresh();
                onViewChange('mcp');
              }}
            >
              <SettingsInfoIcon kind="mcp" />
              <span className="dvx-popover-row-copy">
                <strong>{server.name}</strong>
              </span>
              <span className="dvx-popover-row-value">MCP</span>
            </button>
          ))}
        </>
      ) : null}
      {!showMode &&
      !showAutonomy &&
      !showSkills &&
      !showMcp &&
      !showPlugins &&
      !showAttach &&
      matchedSkills.length === 0 &&
      matchedServers.length === 0 ? (
        <p className="dvx-popover-message">No matching actions.</p>
      ) : null}
      <SettingsStatus settings={settings} />
      {disabled && settings.status === 'ready' ? (
        <p className="dvx-popover-message" role="status">
          Settings can be changed after the current turn.
        </p>
      ) : null}
    </>,
  );
}

/**
 * Filters entries whose name contains the query and ranks prefix
 * hits above substring hits (ties keep catalog order). Descriptions
 * are deliberately not searched — see the settings search comment.
 */
export function rankNameMatches<T extends { readonly name: string }>(
  items: readonly T[],
  normalizedQuery: string,
  limit: number,
): readonly T[] {
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const item of items) {
    const name = item.name.toLocaleLowerCase();
    if (name.startsWith(normalizedQuery)) {
      prefix.push(item);
    } else if (name.includes(normalizedQuery)) {
      substring.push(item);
    }
  }
  return [...prefix, ...substring].slice(0, limit);
}

function SkillsPanel({
  skills,
  disabled,
  onBack,
  onRefresh,
  onToggle,
  onNewSession,
}: {
  readonly skills: SkillsPanelState;
  readonly disabled: boolean;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onToggle: (name: string, disabled: boolean) => void;
  readonly onNewSession?: () => void;
}): React.JSX.Element {
  const busy = skills.status === 'loading' || skills.status === 'idle';
  // Row-level pending: only the toggled row waits for the round-trip,
  // the rest of the panel stays interactive.
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (skills.status !== 'loading') {
      setPendingSkill(null);
    }
  }, [skills.status]);
  // A session switch resets the catalog to 'idle' without a re-query;
  // while this panel is visible that used to deadlock on the loading
  // message, so re-request whenever the visible panel sees an idle
  // catalog. `onRefresh` changes identity with the session, which
  // retries once the new session id lands.
  useEffect(() => {
    if (skills.status === 'idle') {
      onRefresh();
    }
  }, [skills.status, onRefresh]);
  return (
    <div className="dvx-skills-panel">
      <div className="dvx-panel-head">
        <button
          type="button"
          className="dvx-panel-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">Skills</span>
        </button>
        <div className="dvx-panel-actions">
          <button
            type="button"
            className="dvx-panel-action"
            disabled={skills.status === 'loading'}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>
      {skills.status === 'unsupported' || skills.status === 'error' ? (
        <p
          className={`dvx-popover-message ${
            skills.status === 'error' ? 'dvx-error-text' : ''
          }`}
          role={skills.status === 'error' ? 'alert' : 'status'}
        >
          {skills.message}
        </p>
      ) : null}
      {busy && skills.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          Loading skills…
        </p>
      ) : null}
      {skills.status === 'ready' && skills.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          No skills found in this workspace.
        </p>
      ) : null}
      {skills.items.length > 0 ? (
        <ul className="dvx-skill-list" aria-label="Skills">
          {skills.items.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              disabled={disabled}
              pending={pendingSkill === skill.name}
              onToggle={(name, nextDisabled) => {
                setPendingSkill(name);
                setChanged(true);
                onToggle(name, nextDisabled);
              }}
            />
          ))}
        </ul>
      ) : null}
      <p className="dvx-popover-message dvx-skills-session-note">
        Skill changes take effect in new sessions.
        {changed && onNewSession !== undefined ? (
          <>
            {' '}
            <button
              type="button"
              className="dvx-skills-apply-new"
              onClick={onNewSession}
            >
              Start a new session
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

function SkillRow({
  skill,
  disabled,
  pending,
  onToggle,
}: {
  readonly skill: SkillSummary;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly onToggle: (name: string, disabled: boolean) => void;
}): React.JSX.Element {
  return (
    <li className="dvx-skill-row">
      <div className="dvx-skill-copy">
        <span className="dvx-skill-name">
          {skill.name}
          <span className="dvx-skill-location">{skill.location}</span>
          {pending ? (
            <span className="dvx-skill-location" role="status">
              {skill.enabled ? 'Disabling…' : 'Enabling…'}
            </span>
          ) : null}
        </span>
        {skill.description !== null ? (
          <span className="dvx-skill-description" title={skill.description}>
            {skill.description}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className="dvx-skill-switch"
        aria-label={`${skill.name} enabled`}
        aria-checked={skill.enabled}
        disabled={disabled || pending}
        onClick={() => onToggle(skill.name, skill.enabled)}
      >
        <span className="dvx-skill-switch-thumb" aria-hidden="true" />
      </button>
    </li>
  );
}

function McpPanel({
  mcp,
  auth,
  disabled,
  onBack,
  onRefresh,
  onToggle,
  onAdd,
  onRemove,
  onAuthenticate,
}: {
  readonly mcp: McpPanelState;
  readonly auth: McpAuthProgress | null;
  readonly disabled: boolean;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onToggle: (name: string, enabled: boolean) => void;
  readonly onAdd: (params: McpServerAddParams) => void;
  readonly onRemove: (name: string) => void;
  readonly onAuthenticate: (name: string) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const busy = mcp.status === 'loading' || mcp.status === 'idle';
  // Row-level pending: only the mutated row waits for the round-trip.
  const [pending, setPending] = useState<{
    readonly name: string;
    readonly op: 'enable' | 'disable' | 'remove';
  } | null>(null);
  useEffect(() => {
    if (mcp.status !== 'loading') {
      setPending(null);
    }
  }, [mcp.status]);
  // Same session-switch recovery as the skills panel: an idle catalog
  // under a visible panel means nobody re-queried after the reset.
  useEffect(() => {
    if (mcp.status === 'idle') {
      onRefresh();
    }
  }, [mcp.status, onRefresh]);
  const authPending =
    auth !== null &&
    (auth.phase === 'started' || auth.phase === 'browser');
  return (
    <div className="dvx-skills-panel">
      <div className="dvx-panel-head">
        <button
          type="button"
          className="dvx-panel-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">MCP servers</span>
        </button>
        <div className="dvx-panel-actions">
          <button
            type="button"
            className="dvx-panel-action"
            disabled={disabled || busy}
            aria-expanded={adding}
            onClick={() => setAdding((current) => !current)}
          >
            {adding ? 'Close' : 'Add'}
          </button>
          <button
            type="button"
            className="dvx-panel-action"
            disabled={mcp.status === 'loading'}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>
      {adding ? (
        <McpAddServerForm
          disabled={disabled || busy}
          onSubmit={(params) => {
            setAdding(false);
            onAdd(params);
          }}
        />
      ) : null}
      {mcp.status === 'unsupported' || mcp.status === 'error' ? (
        <p
          className={`dvx-popover-message ${
            mcp.status === 'error' ? 'dvx-error-text' : ''
          }`}
          role={mcp.status === 'error' ? 'alert' : 'status'}
        >
          {mcp.message}
        </p>
      ) : null}
      {busy && mcp.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          Loading MCP servers…
        </p>
      ) : null}
      {mcp.status === 'ready' && mcp.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          No MCP servers configured.
        </p>
      ) : null}
      {mcp.items.length > 0 ? (
        <ul className="dvx-skill-list" aria-label="MCP servers">
          {mcp.items.map((server) => (
            <McpServerRow
              key={server.name}
              server={server}
              auth={auth?.serverName === server.name ? auth : null}
              disabled={disabled}
              pendingOp={
                pending?.name === server.name ? pending.op : null
              }
              authDisabled={disabled || busy || authPending}
              onToggle={(name, enabled) => {
                setPending({
                  name,
                  op: enabled ? 'enable' : 'disable',
                });
                onToggle(name, enabled);
              }}
              onRemove={(name) => {
                setPending({ name, op: 'remove' });
                onRemove(name);
              }}
              onAuthenticate={onAuthenticate}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function McpAddServerForm({
  disabled,
  onSubmit,
}: {
  readonly disabled: boolean;
  readonly onSubmit: (params: McpServerAddParams) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [serverType, setServerType] = useState<McpServerType>('stdio');
  const [target, setTarget] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const trimmedName = name.trim();
  const trimmedTarget = target.trim();
  const targetValid =
    serverType === 'stdio'
      ? trimmedTarget.length > 0
      : /^https?:\/\//.test(trimmedTarget);
  const validationMessage =
    trimmedName.length === 0
      ? 'Enter a server name.'
      : !targetValid
        ? serverType === 'stdio'
          ? 'Enter the launch command.'
          : 'Enter a URL starting with http:// or https://.'
        : null;
  const canSubmit = !disabled && validationMessage === null;
  const submit = (): void => {
    if (!canSubmit) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);
    if (serverType === 'stdio') {
      const [command = '', ...args] = trimmedTarget.split(/\s+/);
      onSubmit({
        name: trimmedName,
        serverType,
        command,
        ...(args.length > 0 ? { args } : {}),
      });
    } else {
      onSubmit({ name: trimmedName, serverType, url: trimmedTarget });
    }
  };
  return (
    <form
      className="dvx-mcp-add-form"
      aria-label="Add MCP server"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        className="dvx-mcp-add-input"
        type="text"
        placeholder="Server name"
        aria-label="Server name"
        value={name}
        maxLength={128}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="dvx-mcp-add-types" role="radiogroup" aria-label="Server type">
        {MCP_SERVER_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            className="dvx-mcp-add-type"
            aria-checked={serverType === type}
            onClick={() => setServerType(type)}
          >
            {type}
          </button>
        ))}
      </div>
      <input
        className="dvx-mcp-add-input"
        type="text"
        placeholder={
          serverType === 'stdio'
            ? 'Command, e.g. npx -y my-mcp-server'
            : 'URL, e.g. https://example.com/mcp'
        }
        aria-label={serverType === 'stdio' ? 'Launch command' : 'Server URL'}
        value={target}
        maxLength={1024}
        onChange={(event) => setTarget(event.currentTarget.value)}
      />
      {showValidation && validationMessage !== null ? (
        <p className="dvx-popover-message dvx-error-text" role="alert">
          {validationMessage}
        </p>
      ) : null}
      <button
        type="submit"
        className="dvx-mcp-add-submit"
        disabled={disabled}
      >
        Add server
      </button>
    </form>
  );
}

function McpServerRow({
  server,
  auth,
  disabled,
  pendingOp,
  authDisabled,
  onToggle,
  onRemove,
  onAuthenticate,
}: {
  readonly server: McpServerSummary;
  readonly auth: McpAuthProgress | null;
  readonly disabled: boolean;
  /** Mutation in flight for this row, if any. */
  readonly pendingOp: 'enable' | 'disable' | 'remove' | null;
  readonly authDisabled: boolean;
  readonly onToggle: (name: string, enabled: boolean) => void;
  readonly onRemove: (name: string) => void;
  readonly onAuthenticate: (name: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // A stray click should not leave the destructive confirm armed.
  useEffect(() => {
    if (!confirmingRemove) {
      return;
    }
    const timer = setTimeout(() => setConfirmingRemove(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingRemove]);
  const enabled = server.status !== 'disabled';
  const toolCount = server.toolCount ?? server.tools.length;
  const rowDisabled = disabled || pendingOp !== null;
  // A server needs authentication only while Droid holds no OAuth
  // tokens for it; a signed-in server shows the quiet opposite badge.
  const needsAuth = server.requiresAuth && !server.hasAuthTokens;
  const pendingText =
    pendingOp === 'enable'
      ? 'Enabling…'
      : pendingOp === 'disable'
        ? 'Disabling…'
        : pendingOp === 'remove'
          ? 'Removing…'
          : null;
  const authPending =
    auth !== null &&
    (auth.phase === 'started' || auth.phase === 'browser');
  const authStatusText =
    auth === null
      ? null
      : auth.message ??
        (auth.phase === 'started'
          ? 'Starting authentication…'
          : auth.phase === 'success'
            ? 'Authentication succeeded.'
            : auth.phase === 'cancelled'
              ? 'Authentication was cancelled.'
              : auth.phase === 'failed'
                ? 'Authentication failed.'
                : null);
  return (
    <li className="dvx-skill-row dvx-mcp-row">
      <div className="dvx-skill-copy">
        <span className="dvx-skill-name">
          <span
            className={`dvx-mcp-status dvx-mcp-status-${server.status}`}
            title={server.status}
            aria-hidden="true"
          />
          {server.name}
          <span className="dvx-skill-location">
            {formatLabel(server.status)}
          </span>
          {needsAuth ? (
            <span className="dvx-skill-location">needs auth</span>
          ) : server.requiresAuth ? (
            <span className="dvx-skill-location">authenticated</span>
          ) : null}
          {pendingText !== null ? (
            <span className="dvx-skill-location" role="status">
              {pendingText}
            </span>
          ) : null}
        </span>
        {needsAuth ? (
          <button
            type="button"
            className="dvx-mcp-auth-button"
            disabled={authDisabled}
            onClick={() => onAuthenticate(server.name)}
          >
            {authPending ? 'Authenticating…' : 'Authenticate in browser'}
          </button>
        ) : null}
        {authStatusText !== null ? (
          <span
            className={`dvx-mcp-auth-status${
              auth !== null &&
              (auth.phase === 'failed' || auth.phase === 'error')
                ? ' dvx-error-text'
                : ''
            }`}
            role="status"
          >
            {authStatusText}
          </span>
        ) : null}
        <span className="dvx-mcp-row-actions">
          {server.tools.length > 0 ? (
            <button
              type="button"
              className="dvx-mcp-tools-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Hide tools' : `Show ${toolCount} tools`}
            </button>
          ) : (
            <span className="dvx-skill-description">
              {toolCount} tools
            </span>
          )}
          <button
            type="button"
            className={`dvx-mcp-remove${
              confirmingRemove ? ' dvx-mcp-remove-confirm' : ''
            }`}
            disabled={rowDisabled}
            onClick={() => {
              if (confirmingRemove) {
                setConfirmingRemove(false);
                onRemove(server.name);
              } else {
                setConfirmingRemove(true);
              }
            }}
          >
            {confirmingRemove ? 'Confirm remove' : 'Remove'}
          </button>
        </span>
        {expanded ? (
          <ul className="dvx-mcp-tool-list" aria-label={`${server.name} tools`}>
            {server.tools.map((tool) => (
              <li key={tool.name} className="dvx-mcp-tool">
                <span className="dvx-mcp-tool-name">
                  {tool.name}
                  {tool.readOnly ? (
                    <span className="dvx-skill-location">read-only</span>
                  ) : null}
                  {!tool.enabled ? (
                    <span className="dvx-skill-location">off</span>
                  ) : null}
                </span>
                {tool.description !== null ? (
                  <span
                    className="dvx-skill-description"
                    title={tool.description}
                  >
                    {tool.description}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className="dvx-skill-switch"
        aria-label={`${server.name} enabled`}
        aria-checked={enabled}
        disabled={rowDisabled}
        onClick={() => onToggle(server.name, !enabled)}
      >
        <span className="dvx-skill-switch-thumb" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * Read-only view of the installed plugin catalog. Install, remove,
 * and enable live in the droid CLI for now; this panel only answers
 * "what is installed and active for new sessions".
 */
function PluginsPanel({
  plugins,
  onBack,
  onRefresh,
}: {
  readonly plugins: PluginsPanelState;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  const busy = plugins.status === 'loading' || plugins.status === 'idle';
  // Same session-switch recovery as the skills panel: an idle catalog
  // under a visible panel means nobody re-queried after the reset, so
  // re-request instead of sitting on the loading message forever.
  useEffect(() => {
    if (plugins.status === 'idle') {
      onRefresh();
    }
  }, [plugins.status, onRefresh]);
  return (
    <div className="dvx-skills-panel">
      <div className="dvx-panel-head">
        <button
          type="button"
          className="dvx-panel-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">Plugins</span>
        </button>
        <div className="dvx-panel-actions">
          <button
            type="button"
            className="dvx-panel-action"
            disabled={plugins.status === 'loading'}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>
      {plugins.status === 'unsupported' || plugins.status === 'error' ? (
        <p
          className={`dvx-popover-message ${
            plugins.status === 'error' ? 'dvx-error-text' : ''
          }`}
          role={plugins.status === 'error' ? 'alert' : 'status'}
        >
          {plugins.message}
        </p>
      ) : null}
      {busy && plugins.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          Loading plugins…
        </p>
      ) : null}
      {plugins.status === 'ready' && plugins.items.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          No plugins installed.
        </p>
      ) : null}
      {plugins.items.length > 0 ? (
        <ul className="dvx-skill-list" aria-label="Plugins">
          {plugins.items.map((plugin) => (
            <PluginRow key={plugin.id} plugin={plugin} />
          ))}
        </ul>
      ) : null}
      <p className="dvx-popover-message dvx-skills-session-note">
        {plugins.status === 'ready'
          ? `${plugins.marketplaceCount} ${
              plugins.marketplaceCount === 1
                ? 'marketplace'
                : 'marketplaces'
            } registered. `
          : ''}
        Manage plugins with the droid CLI.
      </p>
    </div>
  );
}

function PluginRow({
  plugin,
}: {
  readonly plugin: PluginSummary;
}): React.JSX.Element {
  return (
    <li className="dvx-skill-row">
      <div className="dvx-skill-copy">
        <span className="dvx-skill-name">
          {plugin.id}
          <span className="dvx-skill-location">{plugin.scope}</span>
        </span>
        <span className="dvx-skill-description" title={plugin.version}>
          {plugin.version}
        </span>
      </div>
      <span className="dvx-popover-row-value">
        {plugin.active ? 'Active' : 'Off'}
      </span>
    </li>
  );
}

function AttachRows({
  disabled,
  onAttach,
}: {
  readonly disabled: boolean;
  readonly onAttach: (source: AttachSource) => void;
}): React.JSX.Element {
  return (
    <div className="dvx-attach-rows">
      <button
        type="button"
        className="dvx-popover-row dvx-attach-row"
        disabled={disabled}
        onClick={() => onAttach('files')}
      >
        <AttachIcon kind="files" />
        <span className="dvx-popover-row-copy">
          <strong>Attach files…</strong>
          <small>Images, PDFs, or text files</small>
        </span>
      </button>
      <button
        type="button"
        className="dvx-popover-row dvx-attach-row"
        disabled={disabled}
        onClick={() => onAttach('editor')}
      >
        <AttachIcon kind="editor" />
        <span className="dvx-popover-row-copy">
          <strong>Attach active editor</strong>
          <small>Current file contents</small>
        </span>
      </button>
      <button
        type="button"
        className="dvx-popover-row dvx-attach-row"
        disabled={disabled}
        onClick={() => onAttach('selection')}
      >
        <AttachIcon kind="selection" />
        <span className="dvx-popover-row-copy">
          <strong>Attach selection</strong>
          <small>Highlighted editor text</small>
        </span>
      </button>
      <button
        type="button"
        className="dvx-popover-row dvx-attach-row"
        disabled={disabled}
        onClick={() => onAttach('problems')}
      >
        <AttachIcon kind="problems" />
        <span className="dvx-popover-row-copy">
          <strong>Attach problems</strong>
          <small>Workspace errors and warnings</small>
        </span>
      </button>
      <button
        type="button"
        className="dvx-popover-row dvx-attach-row"
        disabled={disabled}
        onClick={() => onAttach('git-changes')}
      >
        <AttachIcon kind="git-changes" />
        <span className="dvx-popover-row-copy">
          <strong>Attach git changes</strong>
          <small>Uncommitted diff vs HEAD</small>
        </span>
      </button>
    </div>
  );
}

function AttachIcon({
  kind,
}: {
  readonly kind: AttachSource;
}): React.JSX.Element {
  if (kind === 'files') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M9.5 2.5h-4A1.5 1.5 0 0 0 4 4v8a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 12V5l-2.5-2.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M9.5 2.5V5H12"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'editor') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="2.5"
          y="3.5"
          width="11"
          height="9"
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M5 6.5h6M5 9h4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'problems') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2.8 14 12.6H2L8 2.8Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M8 6.7v2.6"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11" r=".7" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'git-changes') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle
          cx="4.5"
          cy="4"
          r="1.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <circle
          cx="4.5"
          cy="12"
          r="1.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <circle
          cx="11.5"
          cy="7"
          r="1.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M4.5 5.5v5M11.5 8.5c0 2-2 2.5-4 2.7"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 5.5h10M3 8h10M3 10.5h5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <rect
        x="2"
        y="6.9"
        width="12"
        height="2.4"
        rx=".6"
        fill="currentColor"
        opacity=".18"
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

function SettingsDropdown<Value extends string>({
  id,
  title,
  expanded,
  current,
  options,
  disabled,
  onToggle,
  onSelect,
}: {
  readonly id: string;
  readonly title: string;
  readonly expanded: boolean;
  readonly current: Value;
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
  }[];
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (value: Value) => void;
}): React.JSX.Element {
  const currentLabel =
    options.find((option) => option.value === current)?.label ??
    formatLabel(current);
  return (
    <div className="dvx-settings-select" data-expanded={expanded}>
      <button
        type="button"
        className="dvx-popover-row"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        onClick={onToggle}
      >
        <span className="dvx-popover-row-copy">
          <strong>{title}</strong>
        </span>
        <span className="dvx-popover-row-value">{currentLabel}</span>
        <ChevronDownIcon />
      </button>
      {expanded ? (
        <div
          id={id}
          className="dvx-settings-select-options"
          role="radiogroup"
          aria-label={`${title} options`}
        >
          {options.map((option) => {
            const checked = option.value === current;
            return (
              <button
                key={option.value}
                type="button"
                className="dvx-settings-select-option"
                role="radio"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onSelect(option.value)}
              >
                <span>{option.label}</span>
                {checked ? <CheckIcon /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SettingsInfoRow({
  kind,
  label,
}: {
  readonly kind: 'skills' | 'mcp';
  readonly label: string;
}): React.JSX.Element {
  return (
    <div
      className="dvx-settings-info-row"
      aria-label={`${label}: None`}
    >
      <SettingsInfoIcon kind={kind} />
      <span>{label}</span>
      <span className="dvx-settings-info-value">None</span>
    </div>
  );
}

function SettingsInfoIcon({
  kind,
}: {
  readonly kind: 'skills' | 'mcp' | 'plugins';
}): React.JSX.Element {
  if (kind === 'skills') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3.5 5h9M3.5 8h6.5M3.5 11h4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'plugins') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M6 3v2.5M10 3v2.5M4.75 5.5h6.5a.75.75 0 0 1 .75.75V8a4 4 0 0 1-8 0V6.25a.75.75 0 0 1 .75-.75ZM8 12v1.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="9"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect x="7" y="7" width="2" height="2" rx=".4" fill="currentColor" />
    </svg>
  );
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-search-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="3.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="m9.6 9.6 2.9 2.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-chevron-down"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m5 6.5 3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-check-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4 8.25 2.4 2.4L12 5.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

function ContextPopover({
  id,
  context,
  tokenUsage,
  disabled,
  compactPending,
  onRefresh,
  onCompact,
}: {
  readonly id: string;
  readonly context: SessionContextState;
  readonly tokenUsage: SessionTokenUsageState | undefined;
  readonly disabled: boolean;
  readonly compactPending: boolean;
  readonly onRefresh: () => void;
  readonly onCompact: () => void;
}): React.JSX.Element {
  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-context-popover"
      role="dialog"
      aria-label="Context usage"
    >
      <div className="dvx-panel-head">
        <span className="dvx-panel-title">Context usage</span>
        <div className="dvx-panel-actions">
          <button
            type="button"
            className="dvx-panel-action"
            disabled={disabled}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>
      {context.value !== null ? (
        <ContextUsage stats={context.value} />
      ) : (
        context.status === 'loading' ? (
          <p className="dvx-popover-message" role="status">
            Loading context usage…
          </p>
        ) : null
      )}
      {context.status === 'error' ? (
        <p className="dvx-popover-message dvx-error-text" role="alert">
          {context.message}
        </p>
      ) : null}
      {tokenUsage === undefined ? null : (
        <TokenUsageSection usage={tokenUsage} />
      )}
      <div className="dvx-context-compact">
        <button
          type="button"
          className="dvx-context-compact-button"
          disabled={disabled || compactPending}
          aria-busy={compactPending}
          onClick={compactPending ? undefined : onCompact}
        >
          {compactPending ? (
            <>
              <span className="dvx-compact-spinner" aria-hidden="true" />
              Compacting…
            </>
          ) : (
            'Compact conversation'
          )}
        </button>
        <p className="dvx-context-compact-note">
          Summarizes earlier messages to free up context.
        </p>
      </div>
    </div>
  );
}

function ContextUsage({
  stats,
}: {
  readonly stats: NonNullable<SessionContextState['value']>;
}): React.JSX.Element {
  if (!hasUsableContextRatio(stats)) {
    // Degraded visual: the bar stays (full, with an overflow tick at
    // the end) so the card keeps its shape when totals exceed the
    // model limit; the Estimated badge flags the reduced accuracy.
    return (
      <div className="dvx-context-usage dvx-context-usage-unavailable">
        <div className="dvx-context-usage-summary">
          <strong>Over model limit</strong>
          <span className="dvx-context-estimated" aria-hidden="true">
            Estimated
          </span>
          <span>{formatCount(stats.used)} tokens reported</span>
        </div>
        <div
          className="dvx-context-progress dvx-context-progress-over"
          role="progressbar"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={100}
          aria-valuetext={`Estimated over the model limit: ${formatCount(
            stats.used,
          )} tokens reported, limit ${formatCount(stats.limit)}`}
        >
          <span style={{ width: '100%' }} />
          <span className="dvx-context-overflow-tick" aria-hidden="true" />
        </div>
        <p className="dvx-context-usage-note">
          Droid returned totals beyond the model limit. Long sessions can
          continue through context compaction, so this estimate is not a
          trustworthy active-window percentage.
        </p>
        <dl className="dvx-context-details">
          <Stat label="Model limit" value={formatCount(stats.limit)} />
          <Stat label="Accuracy" value={formatLabel(stats.accuracy)} />
        </dl>
      </div>
    );
  }
  const usedPercent =
    Math.min(100, Math.max(0, (stats.used / stats.limit) * 100));
  const roundedPercent = Math.round(usedPercent);

  return (
    <div className="dvx-context-usage">
      <div className="dvx-context-usage-summary">
        <strong>{roundedPercent}% used</strong>
        <span>
          {formatCount(stats.used)} of {formatCount(stats.limit)}
        </span>
      </div>
      <div
        className="dvx-context-progress"
        role="progressbar"
        aria-label="Context used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        aria-valuetext={`${roundedPercent}% used (${formatCount(
          stats.used,
        )} of ${formatCount(stats.limit)})`}
      >
        <span style={{ width: `${usedPercent}%` }} />
      </div>
      <dl className="dvx-context-details">
        <Stat label="Remaining" value={formatCount(stats.remaining)} />
        <Stat label="Accuracy" value={formatLabel(stats.accuracy)} />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const TOKEN_USAGE_ROWS: readonly {
  readonly field: Exclude<keyof TokenUsageBreakdown, 'factoryCredits'>;
  readonly label: string;
}[] = [
  { field: 'inputTokens', label: 'Input' },
  { field: 'outputTokens', label: 'Output' },
  { field: 'cacheReadTokens', label: 'Cache read' },
  { field: 'cacheCreationTokens', label: 'Cache write' },
  { field: 'thinkingTokens', label: 'Thinking' },
];

/**
 * SDK-reported token breakdown as a quiet two-scope ledger (see
 * docs/product/token-usage-design.md). Only scopes the SDK actually
 * reported become columns; before any usage arrives the section
 * renders nothing at all. The SDK exposes no USD cost, so none is
 * shown; the Credits row is the SDK's own `factoryCredits` field and
 * appears only when a scope reports a positive value.
 */
function TokenUsageSection({
  usage,
}: {
  readonly usage: SessionTokenUsageState;
}): React.JSX.Element | null {
  const columns = [
    ...(usage.lastTurn === null
      ? []
      : [{ header: 'Last turn', breakdown: usage.lastTurn }]),
    ...(usage.cumulative === null
      ? []
      : [{ header: 'Session', breakdown: usage.cumulative }]),
  ];
  if (columns.length === 0) {
    return null;
  }
  const showCredits = columns.some(
    ({ breakdown }) => (breakdown.factoryCredits ?? 0) > 0,
  );
  return (
    <div className="dvx-token-usage">
      <table className="dvx-token-usage-table">
        <thead>
          <tr>
            <th scope="col">Token usage</th>
            {columns.map(({ header }) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TOKEN_USAGE_ROWS.map(({ field, label }) => (
            <tr key={field}>
              <th scope="row">{label}</th>
              {columns.map(({ header, breakdown }) => (
                <td key={header}>{formatCount(breakdown[field])}</td>
              ))}
            </tr>
          ))}
          {showCredits ? (
            <tr>
              <th scope="row">Credits</th>
              {columns.map(({ header, breakdown }) => (
                <td key={header}>
                  {breakdown.factoryCredits === undefined
                    ? '—'
                    : formatCredits(breakdown.factoryCredits)}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
      {usage.lastTurn === null ? (
        <p className="dvx-token-usage-note">
          Per-turn detail appears after the next completed turn.
        </p>
      ) : null}
    </div>
  );
}

/** Factory credits may be fractional; token counts never are. */
function formatCredits(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function ModelPopover({
  id,
  settings,
  modelCatalog,
  disabled,
  onUpdate,
}: {
  readonly id: string;
  readonly settings: SessionSettingsState;
  readonly modelCatalog: ModelCatalogState;
  readonly disabled: boolean;
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
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [editingReasoning, setEditingReasoning] = useState(false);
  const [scope, setScope] = useState<'session' | 'spec'>('session');
  const confirmed = settings.value;
  // The spec drafting scope only exists while the session is in Spec
  // mode; leaving Spec mode snaps the popover back to the session scope.
  const specScopeAvailable = confirmed?.interactionMode === 'spec';
  const activeScope = specScopeAvailable ? scope : 'session';
  // In the spec scope an unset drafting model means "session model".
  const scopedModelId =
    activeScope === 'spec'
      ? (confirmed?.specModeModelId ?? confirmed?.modelId)
      : confirmed?.modelId;
  const scopedReasoning =
    activeScope === 'spec'
      ? (confirmed?.specModeReasoningEffort ?? undefined)
      : confirmed?.reasoningEffort;
  const selected =
    confirmed === null || modelCatalog.status !== 'ready'
      ? undefined
      : modelCatalog.items.find((item) => item.id === scopedModelId);
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
      aria-label="Model"
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
                  activeScope === 'spec' ? 'Model default' : undefined
                }
                onSelect={(effort) =>
                  activeScope === 'spec'
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
            {specScopeAvailable ? (
              <div
                className="dvx-model-scope"
                role="radiogroup"
                aria-label="Model scope"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={activeScope === 'session'}
                  className="dvx-model-scope-option"
                  onClick={() => {
                    setScope('session');
                    setEditingReasoning(false);
                  }}
                >
                  Session
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={activeScope === 'spec'}
                  className="dvx-model-scope-option"
                  onClick={() => {
                    setScope('spec');
                    setEditingReasoning(false);
                  }}
                >
                  Spec drafting
                </button>
              </div>
            ) : null}
            {activeScope === 'spec' ? (
              <button
                type="button"
                className="dvx-model-spec-default"
                aria-pressed={confirmed?.specModeModelId === null}
                disabled={
                  disabled || confirmed?.specModeModelId === null
                }
                onClick={() =>
                  onUpdate({ field: 'specModeModelId', value: null })
                }
              >
                {confirmed?.specModeModelId === null
                  ? 'Drafting with the session model'
                  : 'Use session model'}
              </button>
            ) : null}
            <label className="dvx-visually-hidden" htmlFor={`${id}-search`}>
              Search BYOK models
            </label>
            <input
              id={`${id}-search`}
              className="dvx-model-search"
              type="search"
              value={query}
              placeholder="Search BYOK models"
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <div
              className="dvx-model-list"
              role="list"
              aria-label="BYOK models"
            >
              {filtered.map((model) => {
                const isSelected = model.id === scopedModelId;
                const modelLabel = formatRawModelId(model.id);
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
                      disabled={disabled}
                      onClick={() => {
                        if (isSelected) {
                          return;
                        }
                        onUpdate(
                          activeScope === 'spec'
                            ? {
                                field: 'specModeModelId',
                                value: model.id,
                              }
                            : { field: 'modelId', value: model.id },
                        );
                      }}
                    >
                      <strong>{modelLabel}</strong>
                    </button>
                    {isSelected ? (
                      <div className="dvx-model-current-controls">
                        <span className="dvx-model-reasoning-level">
                          {activeScope === 'spec' &&
                          scopedReasoning === undefined
                            ? 'Default'
                            : formatReasoningLabel(scopedReasoning)}
                        </span>
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
                      </div>
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
        </>
      ) : (
        <ModelCatalogStatus
          modelCatalog={modelCatalog}
          current={confirmed}
        />
      )}
      <SettingsStatus settings={settings} />
      {disabled && settings.status === 'ready' ? (
        <p className="dvx-popover-message" role="status">
          Model settings can be changed after the current turn.
        </p>
      ) : null}
    </div>
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
        Options
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
            <span className="dvx-option-copy">
              <strong>{defaultOptionLabel}</strong>
            </span>
            <span className="dvx-radio-mark" aria-hidden="true" />
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
            <span className="dvx-option-copy">
              <strong>{formatReasoningLabel(effort)}</strong>
            </span>
            <span className="dvx-radio-mark" aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  );
}

function SettingsStatus({
  settings,
}: {
  readonly settings: SessionSettingsState;
}): React.JSX.Element | null {
  if (settings.status === 'updating') {
    return (
      <p className="dvx-popover-message" role="status">
        Applying setting…
      </p>
    );
  }
  if (settings.status === 'error') {
    return (
      <p className="dvx-popover-message dvx-error-text" role="alert">
        {settings.message}
      </p>
    );
  }
  return null;
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

function getModelName(
  modelId: string | undefined,
  catalog: ModelCatalogState,
): string {
  if (modelId === undefined) {
    return 'Model';
  }
  if (catalog.status !== 'ready') {
    return formatRawModelId(modelId);
  }
  return formatRawModelId(
    catalog.items.find((model) => model.id === modelId)?.id ?? modelId,
  );
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

function getContextPercent(context: SessionContextState): number {
  if (
    context.value === null ||
    !hasUsableContextRatio(context.value)
  ) {
    return 0;
  }
  return Math.min(
    100,
    Math.max(0, (context.value.used / context.value.limit) * 100),
  );
}

function getContextLabel(context: SessionContextState): string {
  if (context.value === null) {
    return context.status === 'loading'
      ? 'Context usage loading'
      : 'Context usage unavailable';
  }
  if (!hasUsableContextRatio(context.value)) {
    return `Current context window unavailable; Droid reported ${formatCount(
      context.value.used,
    )} tokens against a ${formatCount(context.value.limit)} model limit`;
  }
  return `Context used ${formatCount(context.value.used)} of ${formatCount(
    context.value.limit,
  )}`;
}

function hasUsableContextRatio(
  stats: NonNullable<SessionContextState['value']>,
): boolean {
  return (
    stats.limit > 0 &&
    stats.used <= stats.limit &&
    stats.remaining <= stats.limit
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatLabel(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function formatReasoningLabel(
  value: SessionReasoningEffort | undefined,
): string {
  if (value === undefined) {
    return '';
  }
  return value === 'xhigh' ? 'Extra High' : formatLabel(value);
}
