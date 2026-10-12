import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import type { AssistantWebviewState } from '../state/types';
import type { ChatPort } from '../host/chatIntent';
import { useCapabilityActions } from './composer/useCapabilityActions';
import type { ThemeContextValue } from '../shell/themeController';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { SessionSettingsPanel, SettingChoice } from './SessionSettingsPanel';
import { ContextPanel } from './ContextPanel';
import { McpPanel } from './McpPanel';
import { PluginsPanel, SkillsPanel } from './CapabilityPanels';
import { Input } from '../ui/input';
import { SystemPromptDialog } from './SystemPromptDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { rankNameMatches } from './composer/settingsSearch';
import { useAttachmentActions } from './attachments/useAttachmentActions';

const pages = ['settings', 'model', 'context', 'skills', 'mcp', 'plugins', 'runtime'];

export function EditorSettings({ owner, state, port, blocked, onMissionOpen, missionActive }: {
  readonly owner: string;
  readonly state: Pick<AssistantWebviewState, 'sessionId' | 'connection' | 'interactions' | 'settings' | 'modelCatalog'>;
  readonly port: ChatPort;
  readonly blocked: boolean;
  readonly onMissionOpen?: () => void;
  readonly missionActive?: boolean;
}) {
  const { t } = useI18n();
  const actions = useCapabilityActions({ vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status });
  const disabled = blocked || state.sessionId === null || state.connection.status !== 'connected' || state.interactions.length > 0 || state.settings.value === null || state.settings.status === 'updating';
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("Edit message settings")} disabled={disabled}><Settings /></Button></PopoverTrigger>
    <PopoverContent side="top" className="w-80" data-editor-popup-owner={owner}>
      <SessionSettingsPanel settings={state.settings} catalog={state.modelCatalog} disabled={disabled}
        onMissionOpen={onMissionOpen} missionActive={missionActive}
        onUpdate={actions.handleSettingUpdate} onManageModels={() => port.postMessage({ type: 'models.open' })} />
    </PopoverContent>
  </Popover>;
}

export function SettingsMenu({ state, port, blocked, page, onPageChange, onCompact, compactPending, theme, onNewSession, onMissionOpen, missionActive }: {
  readonly state: AssistantWebviewState;
  readonly port: ChatPort;
  readonly blocked: boolean;
  readonly page: string | null;
  readonly onPageChange: (page: string | null) => void;
  readonly onCompact: () => void;
  readonly compactPending: boolean;
  readonly theme: ThemeContextValue;
  readonly onNewSession: () => void;
  readonly onMissionOpen?: () => void;
  readonly missionActive?: boolean;
}) {
  const { t } = useI18n();
  const actions = useCapabilityActions({ vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status });
  const attachments = useAttachmentActions(port, state.sessionId, state.connection.status);
  const [query, setQuery] = useState('');
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const open = page !== null && pages.includes(page);
  const disabled = blocked || state.sessionId === null || state.connection.status !== 'connected';
  const settingsDisabled = disabled || state.interactions.length > 0 || state.settings.value === null || state.settings.status === 'updating';
  const normalized = query.trim().toLocaleLowerCase();
  const searching = normalized.length > 0;
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => {
    if (!searching || disabled) return;
    if (state.skills.status === 'idle') actions.handleSkillsRefresh();
    if (state.mcp.status === 'idle') actions.handleMcpRefresh();
  }, [searching, disabled]);
  const staticMatches = [
    { name: 'Mode', page: 'settings' }, { name: 'Autonomy', page: 'settings' }, { name: 'Theme', page: 'settings' },
    { name: 'Model and reasoning', page: 'model' }, { name: 'Context', page: 'context' },
    { name: 'Skills', page: 'skills' }, { name: 'MCP servers', page: 'mcp' }, { name: 'Plugins', page: 'plugins' },
    { name: 'Droid terminals', page: 'runtime' }, { name: 'Update Droid', page: 'runtime' },
    { name: 'Managed worktrees', page: 'runtime' }, { name: 'Force archive another session', page: 'runtime' },
    { name: 'Save a history-only note', page: 'runtime' },
  ].map(item => ({ ...item, name: t(item.name) })).filter((item) => item.name.toLocaleLowerCase().includes(normalized));
  const actionMatches = [
    { name: 'System prompt for new sessions', run: () => setSystemPromptOpen(true) },
    { name: 'Attach files', run: attachments.handleAttachFiles },
    { name: 'Attach active editor', run: attachments.handleAttachEditor },
    { name: 'Attach selection', run: attachments.handleAttachSelection },
    { name: 'Attach problems', run: attachments.handleAttachProblems },
    { name: 'Attach Git changes', run: attachments.handleAttachGitChanges },
  ].map(item => ({ ...item, name: t(item.name) })).filter((item) => item.name.toLocaleLowerCase().includes(normalized));
  const skillMatches = searching ? rankNameMatches(state.skills.items, normalized, 5) : [];
  const serverMatches = searching ? rankNameMatches(state.mcp.items, normalized, 5) : [];
  const go = (target: string) => { setQuery(''); onPageChange(target); };
  useEffect(() => {
    if (page === 'skills') actions.handleSkillsRefresh();
    else if (page === 'mcp') actions.handleMcpRefresh();
    else if (page === 'plugins') actions.handlePluginsRefresh();
    else if (page === 'context') actions.handleContextRefresh();
  }, [page, actions.handleSkillsRefresh, actions.handleMcpRefresh, actions.handlePluginsRefresh, actions.handleContextRefresh]);
  return (
    <><SystemPromptDialog open={systemPromptOpen} onOpenChange={setSystemPromptOpen} port={port} />
    <Popover open={open} onOpenChange={(value) => onPageChange(value ? 'settings' : null)}>
      <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("Session settings")} disabled={disabled}><Settings /></Button></PopoverTrigger>
      <PopoverContent side="top" className="w-80 space-y-3">
        <Input type="search" aria-label={t("Search actions")} placeholder={t("Search actions, skills, MCP…")} value={query} onChange={(event) => setQuery(event.target.value)} />
        {searching ? <div role="region" aria-label={t("Matching actions")} className="max-h-80 overflow-auto">
          {[...staticMatches, ...skillMatches.map((item) => ({ name: `${item.name} · Skill`, page: 'skills' })), ...serverMatches.map((item) => ({ name: `${item.name} · MCP`, page: 'mcp' }))].map((item) =>
            <Button key={item.name} variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-left" onClick={() => go(item.page)}>{item.name}</Button>)}
          {actionMatches.map((item) => <Button key={item.name} variant="ghost" className="w-full justify-start" disabled={disabled || state.interactions.length > 0}
            onClick={() => { onPageChange(null); item.run(); }}>{item.name}</Button>)}
          {staticMatches.length + actionMatches.length + skillMatches.length + serverMatches.length === 0 ? <p className="text-xs text-muted-foreground">{t("No matching actions.")}</p> : null}
        </div> : <>
        <Tabs value={page === 'model' ? 'settings' : page ?? 'settings'} onValueChange={onPageChange}>
          <TabsList aria-label={t("Settings sections")} className="flex-wrap">{pages.filter((name) => name !== 'model').map((name) => (
            <TabsTrigger key={name} value={name}>{t(({ settings: 'Settings', model: 'Model', context: 'Context', skills: 'Skills', mcp: 'MCP servers', plugins: 'Plugins', runtime: 'Runtime' } as Record<string, string>)[name] ?? name)}</TabsTrigger>
          ))}</TabsList>
          <TabsContent value={page === 'model' ? 'settings' : page ?? 'settings'} className="space-y-3 pt-3 outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {page === 'settings' || page === 'model' ? <>
          <SessionSettingsPanel settings={state.settings} catalog={state.modelCatalog} disabled={settingsDisabled} onUpdate={actions.handleSettingUpdate} onManageModels={() => {
            onPageChange(null);
            port.postMessage({ type: 'models.open' });
          }} onMissionOpen={onMissionOpen ? () => { onPageChange(null); onMissionOpen(); } : undefined} missionActive={missionActive} />
          <SettingChoice label={t("Theme")} value={theme.preference} options={[
            { label: t('Auto'), value: 'auto' }, { label: t('Light'), value: 'light' }, { label: t('Dark'), value: 'dark' },
          ]} disabled={false} onChange={theme.onPreferenceChange} />
        </> : null}
        {page === 'context' ? <ContextPanel context={state.context} usage={state.tokenUsage} disabled={disabled} compactPending={compactPending} onRefresh={actions.handleContextRefresh} onCompact={onCompact} /> : null}
        {page === 'skills' ? <><SkillsPanel key={state.sessionId} skills={state.skills} disabled={settingsDisabled} onRefresh={actions.handleSkillsRefresh} onToggle={actions.handleSkillToggle} onNewSession={() => { onPageChange(null); onNewSession(); }} />
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'skills' }); }}>{t("Inspect skills & manage scope…")}</Button></> : null}
        {page === 'mcp' ? <><McpPanel key={state.sessionId} mcp={state.mcp} auth={state.mcpAuth} disabled={settingsDisabled} onRefresh={actions.handleMcpRefresh} onToggle={actions.handleMcpServerToggle} onAdd={actions.handleMcpServerAdd} onRemove={actions.handleMcpServerRemove} onAuthenticate={actions.handleMcpServerAuthenticate} />
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'mcp' }); }}>{t("Manage tools & sign-in…")}</Button></> : null}
        {page === 'plugins' ? <PluginsPanel plugins={state.plugins} onRefresh={actions.handlePluginsRefresh} onManage={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'plugins' }); }} /> : null}
        {page === 'runtime' ? <section aria-label={t("Droid runtime management")} className="space-y-3 text-xs">
          <p className="text-muted-foreground">{t("Manage Droid-owned resources using native editor controls. Changes require confirmation.")}</p>
          <Button variant="outline" className="w-full justify-start" disabled={disabled}
            onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'terminals' }); }}>{t("Droid session terminals…")}</Button>
          <Button variant="outline" className="w-full justify-start" disabled={disabled}
            onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'updates' }); }}>{t("Droid updates…")}</Button>
          <Button variant="outline" className="w-full justify-start" disabled={disabled}
            onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'worktrees' }); }}>{t("Managed worktrees…")}</Button>
          <Button variant="outline" className="w-full justify-start" disabled={disabled}
            onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'archive' }); }}>{t("Force archive another session…")}</Button>
          <Button variant="outline" className="w-full justify-start" disabled={disabled}
            onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'history-note' }); }}>{t("Save a history-only note…")}</Button>
          <p className="text-muted-foreground">{t("Session terminals require daemon mode. They are separate from the read-only tool-output mirror.")}</p>
        </section> : null}
        {page === 'settings' ? <Button variant="outline" size="sm" disabled={disabled}
          onClick={() => { onPageChange(null); port.postMessage({ type: 'capabilities.manage', section: 'defaults' }); }}>{t("Droid defaults & advanced settings…")}</Button> : null}
        {page === 'settings' ? <Button variant="outline" size="sm" onClick={() => { onPageChange(null); setSystemPromptOpen(true); }}>{t("System prompt for new sessions…")}</Button> : null}
          </TabsContent>
        </Tabs>
        </>}
      </PopoverContent>
    </Popover></>
  );
}
