// Skills / MCP / Plugins drill-in panels of the `+` settings popover.

import { useEffect, useState } from 'react';
import { Button } from '../../../webview-v2/ui/button';
import { Input } from '../../../webview-v2/ui/input';
import { RadioGroup, RadioGroupItem, Switch } from '../../../webview-v2/ui/controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../webview-v2/ui/collapsible';
import { readMcpServerDraft } from './mcpServerDraft';

import { MCP_SERVER_TYPES } from '../../../shared/protocol/bounds';
import {
  type McpServerSummary,
  type McpServerType,
  type PluginSummary,
  type SkillSummary,
} from '../../../shared/protocol/settings';
import {
  formatLabel,
  type McpAuthProgress,
  type McpPanelState,
  type McpServerAddParams,
  type PluginsPanelState,
  type SkillsPanelState,
} from './shared';

export function SkillsPanel({
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
        <Button variant="plain" size="none"
          type="button"
          className="dvx-panel-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">Skills</span>
        </Button>
        <div className="dvx-panel-actions">
          <Button variant="plain" size="none"
            type="button"
            className="dvx-panel-action"
            disabled={skills.status === 'loading'}
            onClick={onRefresh}
          >
            Refresh
          </Button>
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
            <Button variant="plain" size="none" type="button" className="dvx-skills-apply-new" onClick={onNewSession}>
              Start a new session
            </Button>
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
      <Switch
        className="dvx-skill-switch h-4 w-7 px-px [&>span]:size-3"
        aria-label={`${skill.name} enabled`}
        checked={skill.enabled}
        disabled={disabled || pending}
        onCheckedChange={(enabled) => onToggle(skill.name, !enabled)}
      />
    </li>
  );
}

export function McpPanel({
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
    auth !== null && (auth.phase === 'started' || auth.phase === 'browser');
  return (
    <div className="dvx-skills-panel">
      <div className="dvx-panel-head">
        <Button variant="plain" size="none"
          type="button"
          className="dvx-panel-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">MCP servers</span>
        </Button>
        <div className="dvx-panel-actions">
          <Button variant="plain" size="none"
            type="button"
            className="dvx-panel-action"
            disabled={disabled || busy}
            aria-expanded={adding}
            onClick={() => setAdding((current) => !current)}
          >
            {adding ? 'Close' : 'Add'}
          </Button>
          <Button variant="plain" size="none"
            type="button"
            className="dvx-panel-action"
            disabled={mcp.status === 'loading'}
            onClick={onRefresh}
          >
            Refresh
          </Button>
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
              pendingOp={pending?.name === server.name ? pending.op : null}
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

/**
 * Deliberately NOT a `<form>`: this card lives inside the
 * assistant-ui composer `<form>`, and Chromium never propagates a
 * nested form's submit event past the outer form element, so the
 * React root's delegated `onSubmit` (and its `preventDefault`) never
 * ran — the browser performed a native GET submission and the
 * navigation killed the whole webview. Submission is a plain button
 * click plus Enter handling on the inputs instead, where the
 * `preventDefault` also stops Enter from implicitly submitting the
 * outer composer form.
 */
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
  const { draft, targetHint: shapeHint } = readMcpServerDraft(name, serverType, target);
  const canSubmit = !disabled && draft !== null;
  const submit = (): void => {
    if (!canSubmit) {
      return;
    }
    onSubmit(draft);
  };
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className="dvx-mcp-add-form" role="form" aria-label="Add MCP server">
      <Input
        className="dvx-mcp-add-input h-auto text-xs"
        type="text"
        placeholder="Server name"
        aria-label="Server name"
        value={name}
        maxLength={128}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={submitOnEnter}
      />
      <RadioGroup className="dvx-mcp-add-types" aria-label="Server type" value={serverType} disabled={disabled}
        onValueChange={(value) => setServerType(value as McpServerType)}>
        {MCP_SERVER_TYPES.map((type) => (
          <RadioGroupItem
            key={type}
            className="dvx-mcp-add-type"
            value={type}
          >
            {type}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <Input
        className="dvx-mcp-add-input h-auto text-xs"
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
        onKeyDown={submitOnEnter}
      />
      {shapeHint !== null ? (
        <p className="dvx-popover-message dvx-error-text" role="alert">
          {shapeHint}
        </p>
      ) : null}
      <Button variant="plain" size="none"
        type="button"
        className="dvx-mcp-add-submit"
        disabled={!canSubmit}
        onClick={submit}
      >
        Add server
      </Button>
    </div>
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
    auth !== null && (auth.phase === 'started' || auth.phase === 'browser');
  const authStatusText =
    auth === null
      ? null
      : (auth.message ??
        (auth.phase === 'started'
          ? 'Starting authentication…'
          : auth.phase === 'success'
            ? 'Authentication succeeded.'
            : auth.phase === 'cancelled'
              ? 'Authentication was cancelled.'
              : auth.phase === 'failed'
                ? 'Authentication failed.'
                : null));
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild><li className="dvx-skill-row dvx-mcp-row">
      <div className="dvx-skill-copy">
        <span className="dvx-skill-name">
          <span
            className={`dvx-mcp-status dvx-mcp-status-${server.status}`}
            title={server.status}
            aria-hidden="true"
          />
          {server.name}
          <span className="dvx-skill-location">{formatLabel(server.status)}</span>
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
          <Button variant="plain" size="none"
            type="button"
            className="dvx-mcp-auth-button"
            disabled={authDisabled}
            onClick={() => onAuthenticate(server.name)}
          >
            {authPending ? 'Authenticating…' : 'Authenticate in browser'}
          </Button>
        ) : null}
        {authStatusText !== null ? (
          <span
            className={`dvx-mcp-auth-status${
              auth !== null && (auth.phase === 'failed' || auth.phase === 'error')
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
            <CollapsibleTrigger asChild><Button variant="plain" size="none"
              type="button"
              className="dvx-mcp-tools-toggle"
            >
              {expanded ? 'Hide tools' : `Show ${toolCount} tools`}
            </Button></CollapsibleTrigger>
          ) : (
            <span className="dvx-skill-description">{toolCount} tools</span>
          )}
          <Button variant="plain" size="none"
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
          </Button>
        </span>
        <CollapsibleContent>
          <ul className="dvx-mcp-tool-list" aria-label={`${server.name} tools`}>
            {server.tools.map((tool) => (
              <li key={tool.name} className="dvx-mcp-tool">
                <span className="dvx-mcp-tool-name">
                  {tool.name}
                  {tool.readOnly ? (
                    <span className="dvx-skill-location">read-only</span>
                  ) : null}
                  {!tool.enabled ? <span className="dvx-skill-location">off</span> : null}
                </span>
                {tool.description !== null ? (
                  <span className="dvx-skill-description" title={tool.description}>
                    {tool.description}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </div>
      <Switch
        className="dvx-skill-switch h-4 w-7 px-px [&>span]:size-3"
        aria-label={`${server.name} enabled`}
        checked={enabled}
        disabled={rowDisabled}
        onCheckedChange={(next) => onToggle(server.name, next)}
      />
    </li></Collapsible>
  );
}

/**
 * Read-only view of the installed plugin catalog. Install, remove,
 * and enable live in the droid CLI for now; this panel only answers
 * "what is installed and active for new sessions".
 */
export function PluginsPanel({
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
        <Button variant="plain" size="none"
          type="button"
          className="dvx-panel-back"
          aria-label="Back to session controls"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="dvx-panel-title">Plugins</span>
        </Button>
        <div className="dvx-panel-actions">
          <Button variant="plain" size="none"
            type="button"
            className="dvx-panel-action"
            disabled={plugins.status === 'loading'}
            onClick={onRefresh}
          >
            Refresh
          </Button>
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
              plugins.marketplaceCount === 1 ? 'marketplace' : 'marketplaces'
            } registered. `
          : ''}
        Manage plugins with the droid CLI.
      </p>
    </div>
  );
}

function PluginRow({ plugin }: { readonly plugin: PluginSummary }): React.JSX.Element {
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
      <span className="dvx-popover-row-value">{plugin.active ? 'Active' : 'Off'}</span>
    </li>
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
