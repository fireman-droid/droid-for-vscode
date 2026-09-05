// The `+` settings popover: attach rows, inline setting dropdowns,
// capability drill-in links, and the action search. Moved verbatim
// from ComposerControls.tsx (structure-only split).

import { useRef, useState } from 'react';

import type { SessionSettingsState } from '../../../shared/bridgeMessages';
import { useTheme } from '../theme';
import type { SessionSettingSelection } from '../useOptimisticSetting';
import { McpPanel, PluginsPanel, SkillsPanel } from './capabilityPanels';
import {
  AUTONOMY_OPTIONS,
  ChevronDownIcon,
  MODE_OPTIONS,
  SettingsStatus,
  THEME_OPTIONS,
  formatLabel,
  type AttachSource,
  type McpAuthProgress,
  type McpPanelState,
  type McpServerAddParams,
  type PluginsPanelState,
  type SettingsView,
  type SkillsPanelState,
} from './shared';

export function SettingsPopover({
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
  const theme = useTheme();
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
  const showTheme =
    normalizedQuery.length === 0 || 'theme'.includes(normalizedQuery);
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
      {showTheme ? (
        <SettingsDropdown
          id={`${id}-theme`}
          title="Theme"
          expanded={view === 'theme'}
          current={theme.preference}
          options={THEME_OPTIONS}
          // Pure webview appearance — never blocked by a running turn.
          disabled={false}
          onToggle={() =>
            onViewChange(view === 'theme' ? 'root' : 'theme')
          }
          onSelect={(value) => {
            onViewChange('root');
            if (value !== theme.preference) {
              theme.onPreferenceChange(value);
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
      !showTheme &&
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
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="dvx-popover-row-copy">
          <strong>{title}</strong>
        </span>
        <span className="dvx-popover-row-value">{currentLabel}</span>
        <ChevronDownIcon />
      </button>
      <div
        id={id}
        className="dvx-settings-select-motion"
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="dvx-settings-select-clip">
          <div
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
        </div>
      </div>
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
