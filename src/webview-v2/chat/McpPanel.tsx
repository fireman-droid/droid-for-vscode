import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { MCP_SERVER_TYPES } from '../../shared/protocol/bounds';
import type { McpServerSummary, McpServerType } from '../../shared/protocol/settings';
import type { McpAuthProgress, McpPanelState } from './composer/shared';
import { readMcpServerDraft, type McpServerDraft } from './composer/mcpServerDraft';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { SettingChoice } from './SessionSettingsPanel';

interface McpActions {
  readonly onRefresh: () => void;
  readonly onToggle: (name: string, enabled: boolean) => void;
  readonly onAdd: (draft: McpServerDraft) => void;
  readonly onRemove: (name: string) => void;
  readonly onAuthenticate: (name: string) => void;
}

export function McpPanel({ mcp, auth, disabled, ...actions }: McpActions & {
  readonly mcp: McpPanelState;
  readonly auth: McpAuthProgress | null;
  readonly disabled: boolean;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<{ name: string; label: string } | null>(null);
  useEffect(() => {
    if (mcp.status !== 'loading') setPending(null);
  }, [mcp]);
  const busy = mcp.status === 'loading' || pending !== null;
  const authPending = auth?.phase === 'started' || auth?.phase === 'browser';
  return <section aria-label={t("MCP servers")} className="space-y-3 text-xs">
    <div className="flex gap-1">
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => setAdding(!adding)}>{adding ? t("Cancel add") : t("Add server")}</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={actions.onRefresh}>{t("Refresh")}</Button>
    </div>
    {adding ? <McpServerForm disabled={disabled || busy} onAdd={(draft) => {
      setPending({ name: draft.name, label: t('Adding…') });
      setAdding(false);
      actions.onAdd(draft);
    }} /> : null}
    {'message' in mcp ? <p role={mcp.status === 'error' ? 'alert' : 'status'} className="text-muted-foreground">{mcp.message}</p> : null}
    {busy ? <p role="status" className="text-muted-foreground">{pending ? `${pending.name}: ${pending.label}` : t("Loading MCP servers…")}</p> : null}
    {mcp.status === 'ready' && mcp.items.length === 0 ? <p role="status" className="text-muted-foreground">{t("No MCP servers configured.")}</p> : null}
    <ul className="space-y-3">{mcp.items.map((server) => <McpServerRow
      key={server.name} server={server} disabled={disabled || busy}
      auth={auth?.serverName === server.name ? auth : null} authDisabled={disabled || busy || authPending}
      onAuthenticate={() => actions.onAuthenticate(server.name)}
      onToggle={() => {
        const enabled = server.status === 'disabled';
        setPending({ name: server.name, label: enabled ? 'Enabling…' : 'Disabling…' });
        actions.onToggle(server.name, enabled);
      }}
      onRemove={() => {
        setPending({ name: server.name, label: 'Removing…' });
        actions.onRemove(server.name);
      }}
    />)}</ul>
  </section>;
}

function McpServerForm({ disabled, onAdd }: {
  readonly disabled: boolean;
  readonly onAdd: (draft: McpServerDraft) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [serverType, setServerType] = useState<McpServerType>('stdio');
  const [target, setTarget] = useState('');
  const { draft, targetHint } = readMcpServerDraft(name, serverType, target);
  const submit = () => { if (!disabled && draft !== null) onAdd(draft); };
  return <div role="form" aria-label={t("Add MCP server")} className="space-y-2 border-b border-[var(--panel-edge)] pb-3" onKeyDown={(event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      submit();
    }
  }}>
    <label className="block space-y-1"><span>{t("Server name")}</span><Input maxLength={128} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <SettingChoice label={t("Transport")} value={serverType} options={MCP_SERVER_TYPES.map((value) => ({ value, label: value }))} disabled={disabled} onChange={setServerType} />
    <label className="block space-y-1"><span>{serverType === 'stdio' ? t("Command") : 'URL'}</span><Input maxLength={1024} value={target} onChange={(event) => setTarget(event.target.value)} placeholder={serverType === 'stdio' ? 'command --argument' : 'https://server.example/mcp'} /></label>
    {targetHint ? <p role="status" className="text-destructive">{targetHint}</p> : null}
    <Button variant="outline" size="sm" disabled={disabled || draft === null} onClick={submit}>{t("Add")}</Button>
  </div>;
}

function McpServerRow({ server, auth, disabled, authDisabled, onToggle, onRemove, onAuthenticate }: {
  readonly server: McpServerSummary;
  readonly auth: McpAuthProgress | null;
  readonly disabled: boolean;
  readonly authDisabled: boolean;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
  readonly onAuthenticate: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  const authPending = auth?.phase === 'started' || auth?.phase === 'browser';
  const needsAuth = server.requiresAuth && !server.hasAuthTokens;
  return <li className="space-y-2 border-b border-[var(--panel-edge)] pb-2">
    <div><p className="break-words font-medium">{server.name}</p><p className="text-muted-foreground">{server.status} · {server.toolCount ?? '?'} {t("tools")}{server.requiresAuth ? needsAuth ? t("· needs auth") : t("· authenticated") : ''}</p></div>
    <div className="flex flex-wrap gap-1">
      <Button variant="outline" size="sm" disabled={disabled} onClick={onToggle}>{server.status === 'disabled' ? t("Enable") : t("Disable")}</Button>
      <Button variant="ghost" size="sm" disabled={disabled} aria-label={`${confirming ? t("Confirm remove") : t("Remove")} ${server.name}`} onClick={() => {
        if (confirming) { setConfirming(false); onRemove(); }
        else setConfirming(true);
      }}>{confirming ? t("Confirm remove") : t("Remove")}</Button>
      {needsAuth ? <Button variant="outline" size="sm" disabled={authDisabled} onClick={onAuthenticate}>{authPending ? t("Authenticating…") : t("Authenticate in browser")}</Button> : null}
    </div>
    {auth ? <p role={auth.phase === 'failed' || auth.phase === 'error' ? 'alert' : 'status'}>{auth.message ?? auth.phase}</p> : null}
    {server.tools.length > 0 ? <Collapsible>
      <CollapsibleTrigger asChild><Button variant="plain" size="none" className="text-muted-foreground">{t("Tools")}</Button></CollapsibleTrigger>
      <CollapsibleContent>
      <ul className="mt-1 space-y-2 pl-2">{server.tools.map((tool) => <li key={tool.name} className="break-words">
        <p>{tool.name}{tool.enabled ? '' : t("· disabled")}{tool.readOnly ? t("· read only") : ''}</p>
        <p className="text-muted-foreground">{tool.description}</p>
      </li>)}</ul>
      </CollapsibleContent>
    </Collapsible> : null}
  </li>;
}
