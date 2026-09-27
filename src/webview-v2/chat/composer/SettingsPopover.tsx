// The `+` popover keeps attachments, session settings and capability search together.

import { useRef, useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../../ui/collapsible';
import { RadioGroup, RadioGroupItem } from '../../ui/controls';
import { rankNameMatches } from './settingsSearch';
export { rankNameMatches } from './settingsSearch';

import { type SessionSettingsState } from '../../../shared/protocol/settings';
import { useTheme } from '../../shell/themeController';
import type { SessionSettingSelection } from './useOptimisticSetting';
import { McpPanel, PluginsPanel, SkillsPanel } from './capabilityPanels';
import {
  AUTONOMY_OPTIONS,
  ChevronDownIcon,
  MODE_OPTIONS,
  SettingsStatus,
  THEME_OPTIONS,
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
  showModeControl = true,
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
  readonly showModeControl?: boolean;
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
    view === 'skills' || view === 'mcp' || view === 'plugins' ? view : 'root';
  const previousGroupRef = useRef(group);
  const directionRef = useRef<'forward' | 'back' | null>(null);
  if (previousGroupRef.current !== group) {
    directionRef.current = group === 'root' ? 'back' : 'forward';
    previousGroupRef.current = group;
  }
  const shell = (label: string, content: React.JSX.Element): React.JSX.Element => (
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
  const showMode = showModeControl && (normalizedQuery.length === 0 || 'mode'.includes(normalizedQuery));
  const showAutonomy =
    normalizedQuery.length === 0 || 'autonomy'.includes(normalizedQuery);
  const showTheme = normalizedQuery.length === 0 || 'theme'.includes(normalizedQuery);
  const showSkills = normalizedQuery.length === 0 || 'skills'.includes(normalizedQuery);
  const showMcp = normalizedQuery.length === 0 || 'mcp servers'.includes(normalizedQuery);
  const showPlugins = normalizedQuery.length === 0 || 'plugins'.includes(normalizedQuery);
  const showAttach =
    normalizedQuery.length === 0 ||
    'attach files editor selection context'.includes(normalizedQuery);
  // Real catalog entries also answer the search, so typing a skill or
  // server name surfaces it directly instead of only the static rows.
  // Matching is name-only (Cursor behavior): description hits pulled
  // in unrelated entries (searching "figma" surfaced agent-browser
  // because its description mentions Figma) with no visible reason.
  const matchedSkills =
    normalizedQuery.length === 0 ? [] : rankNameMatches(skills.items, normalizedQuery, 5);
  const matchedServers =
    normalizedQuery.length === 0 ? [] : rankNameMatches(mcp.items, normalizedQuery, 5);

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
        <Input
          id={`${id}-action-search`}
          className="dvx-settings-search h-9 rounded-none border-0 bg-transparent p-0 text-[13px] focus-visible:border-transparent"
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
          onToggle={() => onViewChange(view === 'mode' ? 'root' : 'mode')}
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
          onToggle={() => onViewChange(view === 'autonomy' ? 'root' : 'autonomy')}
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
          onToggle={() => onViewChange(view === 'theme' ? 'root' : 'theme')}
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
        <Button variant="plain" size="none"
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
        </Button>
      ) : null}
      {showMcp ? (
        <Button variant="plain" size="none"
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
              ? `${
                  mcp.items.filter((server) => server.status !== 'disabled').length
                }/${mcp.items.length} on`
              : ''}
          </span>
          <ChevronDownIcon />
        </Button>
      ) : null}
      {showPlugins ? (
        <Button variant="plain" size="none"
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
            {plugins.status === 'ready' ? `${plugins.items.length} installed` : ''}
          </span>
          <ChevronDownIcon />
        </Button>
      ) : null}
      {matchedSkills.length > 0 || matchedServers.length > 0 ? (
        <>
          <div className="dvx-settings-divider" />
          {matchedSkills.map((skill) => (
            <Button variant="plain" size="none"
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
                {skill.description !== null ? <span>{skill.description}</span> : null}
              </span>
              <span className="dvx-popover-row-value">Skill</span>
            </Button>
          ))}
          {matchedServers.map((server) => (
            <Button variant="plain" size="none"
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
            </Button>
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

function AttachRows({
  disabled,
  onAttach,
}: {
  readonly disabled: boolean;
  readonly onAttach: (source: AttachSource) => void;
}): React.JSX.Element {
  return (
    <div className="dvx-attach-rows">
      <Button variant="plain" size="none"
        type="button"
        className="dvx-popover-row dvx-attach-row"
        title="Images, PDFs, or text files"
        disabled={disabled}
        onClick={() => onAttach('files')}
      >
        <AttachIcon kind="files" />
        <span className="dvx-popover-row-copy">
          <strong>Attach files…</strong>
        </span>
      </Button>
      <Button variant="plain" size="none"
        type="button"
        className="dvx-popover-row dvx-attach-row"
        title="Current file contents"
        disabled={disabled}
        onClick={() => onAttach('editor')}
      >
        <AttachIcon kind="editor" />
        <span className="dvx-popover-row-copy">
          <strong>Attach active editor</strong>
        </span>
      </Button>
      <Button variant="plain" size="none"
        type="button"
        className="dvx-popover-row dvx-attach-row"
        title="Highlighted editor text"
        disabled={disabled}
        onClick={() => onAttach('selection')}
      >
        <AttachIcon kind="selection" />
        <span className="dvx-popover-row-copy">
          <strong>Attach selection</strong>
        </span>
      </Button>
      <Button variant="plain" size="none"
        type="button"
        className="dvx-popover-row dvx-attach-row"
        title="Workspace errors and warnings"
        disabled={disabled}
        onClick={() => onAttach('problems')}
      >
        <AttachIcon kind="problems" />
        <span className="dvx-popover-row-copy">
          <strong>Attach problems</strong>
        </span>
      </Button>
      <Button variant="plain" size="none"
        type="button"
        className="dvx-popover-row dvx-attach-row"
        title="Uncommitted diff vs HEAD"
        disabled={disabled}
        onClick={() => onAttach('git-changes')}
      >
        <AttachIcon kind="git-changes" />
        <span className="dvx-popover-row-copy">
          <strong>Attach git changes</strong>
        </span>
      </Button>
    </div>
  );
}

function AttachIcon({ kind }: { readonly kind: AttachSource }): React.JSX.Element {
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
        <circle cx="4.5" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4.5" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="11.5" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2" />
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
  const trigger = useRef<HTMLButtonElement>(null);
  const select = (value: Value) => {
    onSelect(value);
    trigger.current?.focus({ preventScroll: true });
  };
  return (
    <Collapsible className="dvx-settings-select" data-expanded={expanded} open={expanded}
      onOpenChange={(open) => { if (open !== expanded) onToggle(); }}>
      <CollapsibleTrigger asChild>
        <Button ref={trigger} variant="plain" size="none" className="dvx-popover-row"
          aria-label={title} aria-controls={id} disabled={disabled}>
          <span className="dvx-popover-row-copy"><strong>{title}</strong></span>
          <span className="dvx-popover-row-value">{options.find((option) => option.value === current)?.label ?? current}</span>
          <ChevronDownIcon />
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent id={id} open={expanded}>
        <RadioGroup className="dvx-settings-select-options" aria-label={`${title} options`}
          value={current} disabled={disabled} onValueChange={(value) => select(value as Value)}>
          {options.map((option) => (
            <label key={option.value} className="dvx-option-row dvx-settings-inline-option">
              <span>{option.label}</span>
              <RadioGroupItem value={option.value} aria-label={option.label}
                onClick={() => { if (option.value === current) select(current); }} />
            </label>
          ))}
        </RadioGroup>
      </AnimatedCollapsibleContent>
    </Collapsible>
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
    <svg className="dvx-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="m9.6 9.6 2.9 2.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

