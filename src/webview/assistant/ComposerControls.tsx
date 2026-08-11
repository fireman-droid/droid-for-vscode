import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  ConfirmedSessionSettings,
  McpAuthPhase,
  McpServerSummary,
  ModelCatalogItem,
  ModelCatalogState,
  SessionAutonomyLevel,
  SessionContextState,
  SessionInteractionMode,
  SessionMcpState,
  SessionReasoningEffort,
  SessionSettingUpdateMessage,
  SessionSettingsState,
  SessionSkillsState,
  SkillSummary,
} from '../../shared/bridgeMessages';

type OpenPanel = 'settings' | 'context' | 'model' | 'mode' | null;
type SettingsView = 'root' | 'mode' | 'autonomy' | 'skills' | 'mcp';

export type SkillsPanelState =
  | SessionSkillsState
  | { readonly status: 'idle'; readonly items: readonly [] };

export type McpPanelState =
  | SessionMcpState
  | { readonly status: 'idle'; readonly items: readonly [] };

/** Progress of the one in-flight MCP browser authentication flow. */
export interface McpAuthProgress {
  readonly serverName: string;
  readonly phase: McpAuthPhase;
  readonly message: string | null;
}

interface ComposerControlsProps {
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly disabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly onContextRefresh: () => void;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
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
  modelCatalog,
  skills,
  mcp,
  disabled,
  settingUpdatesDisabled,
  onContextRefresh,
  onCompact,
  onSettingUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  mcpAuth,
  onMcpServerAuthenticate,
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

  useEffect(() => {
    if (openPanel === null) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !controlsRef.current?.contains(event.target)
      ) {
        setOpenPanel(null);
        setSettingsView('root');
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenPanel(null);
        setSettingsView('root');
      }
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openPanel]);

  const toggle = (panel: Exclude<OpenPanel, null>): void => {
    setOpenPanel((current) => (current === panel ? null : panel));
    setSettingsView('root');
  };

  return (
    <div className="dvx-composer-controls" ref={controlsRef}>
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
            <circle className="dvx-context-ring-track" cx="12" cy="12" r="9" />
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
      </div>

      <button
        type="button"
        className="dvx-mode-trigger"
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

      {openPanel === 'settings' ? (
        <SettingsPopover
          id={`${panelId}-settings`}
          view={settingsView}
          settings={settings}
          skills={skills}
          mcp={mcp}
          disabled={settingControlsDisabled}
          attachDisabled={disabled}
          onViewChange={setSettingsView}
          onUpdate={onSettingUpdate}
          onSkillsRefresh={onSkillsRefresh}
          onSkillToggle={onSkillToggle}
          onMcpRefresh={onMcpRefresh}
          onMcpServerToggle={onMcpServerToggle}
          mcpAuth={mcpAuth}
          onMcpServerAuthenticate={onMcpServerAuthenticate}
          onAttach={(source) => {
            setOpenPanel(null);
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
      {openPanel === 'context' ? (
        <ContextPopover
          id={`${panelId}-context`}
          context={context}
          disabled={disabled || context.status === 'loading'}
          onRefresh={onContextRefresh}
          onCompact={onCompact}
        />
      ) : null}
      {openPanel === 'mode' && confirmed !== null ? (
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
                  setOpenPanel(null);
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
      {openPanel === 'model' && confirmed !== null ? (
        <ModelPopover
          id={`${panelId}-model`}
          settings={settings}
          modelCatalog={modelCatalog}
          disabled={settingControlsDisabled}
          onUpdate={(update) => {
            onSettingUpdate(update);
            setOpenPanel(null);
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
  disabled,
  attachDisabled,
  onViewChange,
  onUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  mcpAuth,
  onMcpServerAuthenticate,
  onAttach,
}: {
  readonly id: string;
  readonly view: SettingsView;
  readonly settings: SessionSettingsState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
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
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onAttach: (source: AttachSource) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const confirmed = settings.value;
  if (confirmed === null) {
    return (
      <div
        id={id}
        className="dvx-composer-popover dvx-settings-popover"
        role="dialog"
        aria-label="Session controls"
      >
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
      </div>
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
  const showAttach =
    normalizedQuery.length === 0 ||
    'attach files editor selection context'.includes(normalizedQuery);

  if (view === 'skills') {
    return (
      <div
        id={id}
        className="dvx-composer-popover dvx-settings-popover"
        role="dialog"
        aria-label="Skills"
      >
        <SkillsPanel
          skills={skills}
          disabled={disabled}
          onBack={() => onViewChange('root')}
          onRefresh={onSkillsRefresh}
          onToggle={onSkillToggle}
        />
      </div>
    );
  }

  if (view === 'mcp') {
    return (
      <div
        id={id}
        className="dvx-composer-popover dvx-settings-popover"
        role="dialog"
        aria-label="MCP servers"
      >
        <McpPanel
          mcp={mcp}
          auth={mcpAuth}
          disabled={disabled}
          onBack={() => onViewChange('root')}
          onRefresh={onMcpRefresh}
          onToggle={onMcpServerToggle}
          onAuthenticate={onMcpServerAuthenticate}
        />
      </div>
    );
  }

  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-settings-popover"
      role="dialog"
      aria-label="Session controls"
    >
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
            setQuery(event.currentTarget.value);
            onViewChange('root');
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
            if (skills.status === 'idle' || skills.status === 'error') {
              onSkillsRefresh();
            }
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
            if (mcp.status === 'idle' || mcp.status === 'error') {
              onMcpRefresh();
            }
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
      {!showMode &&
      !showAutonomy &&
      !showSkills &&
      !showMcp &&
      !showAttach ? (
        <p className="dvx-popover-message">No matching actions.</p>
      ) : null}
      <SettingsStatus settings={settings} />
      {disabled && settings.status === 'ready' ? (
        <p className="dvx-popover-message" role="status">
          Settings can be changed after the current turn.
        </p>
      ) : null}
    </div>
  );
}

function SkillsPanel({
  skills,
  disabled,
  onBack,
  onRefresh,
  onToggle,
}: {
  readonly skills: SkillsPanelState;
  readonly disabled: boolean;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onToggle: (name: string, disabled: boolean) => void;
}): React.JSX.Element {
  const busy = skills.status === 'loading' || skills.status === 'idle';
  return (
    <div className="dvx-skills-panel">
      <div className="dvx-popover-heading">
        <button
          type="button"
          className="dvx-skills-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <strong>Skills</strong>
        </button>
        <button
          type="button"
          className="dvx-popover-refresh"
          disabled={busy}
          onClick={onRefresh}
        >
          Refresh
        </button>
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
              disabled={disabled || busy}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SkillRow({
  skill,
  disabled,
  onToggle,
}: {
  readonly skill: SkillSummary;
  readonly disabled: boolean;
  readonly onToggle: (name: string, disabled: boolean) => void;
}): React.JSX.Element {
  return (
    <li className="dvx-skill-row">
      <div className="dvx-skill-copy">
        <span className="dvx-skill-name">
          {skill.name}
          <span className="dvx-skill-location">{skill.location}</span>
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
        disabled={disabled}
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
  onAuthenticate,
}: {
  readonly mcp: McpPanelState;
  readonly auth: McpAuthProgress | null;
  readonly disabled: boolean;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onToggle: (name: string, enabled: boolean) => void;
  readonly onAuthenticate: (name: string) => void;
}): React.JSX.Element {
  const busy = mcp.status === 'loading' || mcp.status === 'idle';
  const authPending =
    auth !== null &&
    (auth.phase === 'started' || auth.phase === 'browser');
  return (
    <div className="dvx-skills-panel">
      <div className="dvx-popover-heading">
        <button
          type="button"
          className="dvx-skills-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <strong>MCP servers</strong>
        </button>
        <button
          type="button"
          className="dvx-popover-refresh"
          disabled={busy}
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
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
              disabled={disabled || busy}
              authDisabled={disabled || busy || authPending}
              onToggle={onToggle}
              onAuthenticate={onAuthenticate}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function McpServerRow({
  server,
  auth,
  disabled,
  authDisabled,
  onToggle,
  onAuthenticate,
}: {
  readonly server: McpServerSummary;
  readonly auth: McpAuthProgress | null;
  readonly disabled: boolean;
  readonly authDisabled: boolean;
  readonly onToggle: (name: string, enabled: boolean) => void;
  readonly onAuthenticate: (name: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const enabled = server.status !== 'disabled';
  const toolCount = server.toolCount ?? server.tools.length;
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
          {server.requiresAuth ? (
            <span className="dvx-skill-location">needs auth</span>
          ) : null}
        </span>
        {server.requiresAuth ? (
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
        disabled={disabled}
        onClick={() => onToggle(server.name, !enabled)}
      >
        <span className="dvx-skill-switch-thumb" aria-hidden="true" />
      </button>
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
  readonly kind: 'skills' | 'mcp';
}): React.JSX.Element {
  return kind === 'skills' ? (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 5h9M3.5 8h6.5M3.5 11h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ) : (
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
  disabled,
  onRefresh,
  onCompact,
}: {
  readonly id: string;
  readonly context: SessionContextState;
  readonly disabled: boolean;
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
      <div className="dvx-popover-heading">
        <strong>Context usage</strong>
        <button
          type="button"
          className="dvx-popover-refresh"
          disabled={disabled}
          onClick={onRefresh}
        >
          Refresh
        </button>
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
      <div className="dvx-context-compact">
        <button
          type="button"
          className="dvx-context-compact-button"
          disabled={disabled}
          onClick={onCompact}
        >
          Compact conversation
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
    return (
      <div className="dvx-context-usage dvx-context-usage-unavailable">
        <div className="dvx-context-usage-summary">
          <strong>Current window unavailable</strong>
          <span>{formatCount(stats.used)} tokens reported</span>
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
      { field: 'modelId' | 'reasoningEffort' }
    >,
  ) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [editingReasoning, setEditingReasoning] = useState(false);
  const confirmed = settings.value;
  const selected =
    confirmed === null || modelCatalog.status !== 'ready'
      ? undefined
      : modelCatalog.items.find((item) => item.id === confirmed.modelId);
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
                current={confirmed?.reasoningEffort}
                disabled={disabled}
                onSelect={(effort) =>
                  onUpdate({ field: 'reasoningEffort', value: effort })
                }
              />
            </div>
          ) : null}
          <div className="dvx-model-panel">
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
                const isSelected = model.id === confirmed?.modelId;
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
                        if (!isSelected) {
                          onUpdate({ field: 'modelId', value: model.id });
                        }
                      }}
                    >
                      <strong>{modelLabel}</strong>
                    </button>
                    {isSelected ? (
                      <div className="dvx-model-current-controls">
                        <span className="dvx-model-reasoning-level">
                          {formatReasoningLabel(confirmed?.reasoningEffort)}
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
  onSelect,
}: {
  readonly model: ModelCatalogItem;
  readonly current?: SessionReasoningEffort;
  readonly disabled: boolean;
  readonly onSelect: (effort: SessionReasoningEffort) => void;
}): React.JSX.Element {
  return (
    <>
      <h3 className="dvx-reasoning-heading">
        Options
      </h3>
      <div className="dvx-option-list" role="radiogroup" aria-label="Reasoning">
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
