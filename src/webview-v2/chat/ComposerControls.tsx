import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import { useCapabilityActions } from '../../webview/assistant/composer/useCapabilityActions';
import { useAttachmentActions } from '../../webview/assistant/attachments/useAttachmentActions';
import { useOptimisticSettingPick } from '../../webview/assistant/composer/useOptimisticSetting';
import { ContextPopover } from '../../webview/assistant/composer/ContextPopover';
import { ModePopover } from '../../webview/assistant/composer/ModePopover';
import { ModelPopover, getModelName } from '../../webview/assistant/composer/ModelPopover';
import { SettingsPopover } from '../../webview/assistant/composer/SettingsPopover';
import { getContextLabel, getContextPercent, hasUsableContextRatio } from '../../webview/assistant/composer/contextPresentation';
import { MODE_OPTIONS, formatReasoningLabel, type SettingsView } from '../../webview/assistant/composer/shared';
import { ThemeContext, type ThemeContextValue } from '../../webview/assistant/shell/theme';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { Button } from '../ui/button';

type Panel = 'settings' | 'context' | 'mode' | 'model';

export function ComposerControls({ state, port, blocked, page, navigationId, onPageChange, onCompact, compactPending, theme, onNewSession, onMissionOpen, missionActive, editorOwner, input, action }: {
  readonly state: AssistantWebviewState;
  readonly port: ChatPort;
  readonly blocked: boolean;
  readonly page?: string | null;
  readonly navigationId?: number;
  readonly onPageChange?: (page: string | null) => void;
  readonly onCompact?: () => void;
  readonly compactPending?: boolean;
  readonly theme: ThemeContextValue;
  readonly onNewSession?: () => void;
  readonly onMissionOpen?: () => void;
  readonly missionActive?: boolean;
  readonly editorOwner?: string;
  readonly input?: ReactNode;
  readonly action?: ReactNode;
}) {
  const id = useId();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [view, setView] = useState<SettingsView>('root');
  const frame = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    composer.current = frame.current?.closest<HTMLElement>('[data-composer-surface]') ?? frame.current;
  }, []);
  const actions = useCapabilityActions({ vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status });
  const attachments = useAttachmentActions(port, state.sessionId, state.connection.status);
  const disabled = blocked || state.sessionId === null || state.connection.status !== 'connected';
  const settingsDisabled = disabled || state.interactions.length > 0 || state.settings.value === null || state.settings.status === 'updating';
  const { shownMode, shownModelId, pickSetting } = useOptimisticSettingPick(state.settings, actions.handleSettingUpdate);
  const confirmed = state.settings.value;
  const mode = missionActive ? 'mission' : shownMode;
  const modeLabel = MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Mode';
  const override = confirmed?.interactionMode === 'spec' ? confirmed.specModeModelId : null;
  const model = getModelName(override ?? shownModelId, state.modelCatalog);
  const effort = override !== null ? confirmed?.specModeReasoningEffort ?? undefined : confirmed?.reasoningEffort;
  const percent = getContextPercent(state.context);
  const open = (next: Panel) => {
    setView('root'); setPanel(next);
    if (next === 'context' && panel !== 'context' && !disabled && state.context.status !== 'loading')
      actions.handleContextRefresh();
  };
  const close = () => { setPanel(null); onPageChange?.(null); };
  useEffect(() => {
    if (disabled || !page) return;
    if (page === 'model' || page === 'context' || page === 'mode' || page === 'settings') open(page);
    else if (page === 'skills' || page === 'mcp' || page === 'plugins') {
      open('settings'); setView(page);
      if (page === 'skills') actions.handleSkillsRefresh();
      else if (page === 'mcp') actions.handleMcpRefresh();
      else actions.handlePluginsRefresh();
    }
  }, [page, navigationId]);
  const button = (kind: Panel, label: string, children: React.ReactNode, className = '') => {
    return <Popover open={panel === kind} onOpenChange={(value) => value ? open(kind) : close()}>
      {!editorOwner && kind !== 'model' ? <PopoverAnchor virtualRef={composer} /> : null}
      <PopoverTrigger asChild><Button variant="ghost" size="sm"
        aria-label={label} title={label} disabled={disabled || ((kind === 'mode' || kind === 'model') && confirmed === null)}
        className={`h-[26px] min-w-0 gap-1 px-1.5 text-xs font-normal text-muted-foreground data-[state=open]:bg-[var(--control-surface-active)] data-[state=open]:text-foreground ${className}`}>
        {children}
      </Button></PopoverTrigger>
      <PopoverContent side="top" align={kind === 'model' ? 'end' : 'start'} sideOffset={8}
        className={`v2-composer-panel overflow-y-auto rounded-xl p-0 max-h-[min(520px,var(--radix-popover-content-available-height))] ${kind === 'mode' ? 'w-[160px]' : kind === 'model' ? 'w-[240px]' : 'w-[var(--radix-popover-trigger-width)]'}`}
        data-editor-popup-owner={editorOwner}>
        {kind === 'settings' ? <SettingsPopover id={`${id}-settings`} view={view} settings={state.settings} skills={state.skills} mcp={state.mcp} plugins={state.plugins} showModeControl={false}
          disabled={settingsDisabled} attachDisabled={disabled || state.interactions.length > 0} onViewChange={setView} onUpdate={pickSetting}
          onSkillsRefresh={actions.handleSkillsRefresh} onSkillToggle={actions.handleSkillToggle}
          onMcpRefresh={actions.handleMcpRefresh} onMcpServerToggle={actions.handleMcpServerToggle} onMcpServerAdd={actions.handleMcpServerAdd}
          onMcpServerRemove={actions.handleMcpServerRemove} mcpAuth={state.mcpAuth} onMcpServerAuthenticate={actions.handleMcpServerAuthenticate}
          onPluginsRefresh={actions.handlePluginsRefresh} onNewSession={onNewSession}
          onAttach={(source) => { close(); ({ files: attachments.handleAttachFiles, editor: attachments.handleAttachEditor, selection: attachments.handleAttachSelection, problems: attachments.handleAttachProblems, 'git-changes': attachments.handleAttachGitChanges })[source](); }} /> : null}
        {kind === 'context' ? <ContextPopover id={`${id}-context`} context={state.context} tokenUsage={state.tokenUsage}
          disabled={disabled || state.context.status === 'loading'} compactPending={compactPending ?? false}
          onRefresh={actions.handleContextRefresh} onCompact={onCompact ?? (() => {})} onClose={close} /> : null}
        {kind === 'mode' ? <ModePopover id={`${id}-mode`} settings={state.settings} shownMode={mode ?? 'auto'} disabled={settingsDisabled}
          onSelect={(value) => { close(); if (value === 'mission') onMissionOpen?.(); else if (value !== confirmed?.interactionMode) pickSetting({ field: 'interactionMode', value }); }} /> : null}
        {kind === 'model' ? <ModelPopover id={`${id}-model`} settings={state.settings} modelCatalog={state.modelCatalog} disabled={settingsDisabled}
          onUpdate={(update) => { pickSetting(update); close(); }} onManageModels={close} onOpenModels={() => port.postMessage({ type: 'models.open' })} /> : null}
      </PopoverContent>
    </Popover>;
  };
  return <ThemeContext.Provider value={theme}><div ref={frame} className={editorOwner ? 'flex min-w-0 flex-1 items-center gap-1' : 'v2-composer-input-row'}>
    {!editorOwner ? button('settings', 'Session controls', <Plus />, 'v2-composer-add w-[26px] shrink-0 p-0') : null}
    {input}
    {button('mode', `Mode: ${modeLabel}`, <><span>{modeLabel}</span><ChevronDown className="dvx-select-icon size-3" aria-hidden="true" /></>, editorOwner ? 'ml-auto shrink-0' : 'v2-composer-mode shrink-0')}
    {!editorOwner ? button('context', getContextLabel(state.context),
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".25" />
        {state.context.value && hasUsableContextRatio(state.context.value) ? <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"
          pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 12 12)" /> : null}
      </svg>, 'v2-composer-context w-[22px] shrink-0 p-0') : null}
    {button('model', `Model: ${model}${effort ? `, ${formatReasoningLabel(effort)}` : ''}${override ? ', Spec drafting' : ''}`,
      <><span className="truncate">{model}{effort ? <span> {formatReasoningLabel(effort)}</span> : null}{override ? ' spec' : ''}</span><ChevronDown className="dvx-select-icon size-3 shrink-0" aria-hidden="true" /></>, editorOwner ? 'max-w-[56%]' : 'v2-composer-model')}
    {action}
  </div></ThemeContext.Provider>;
}
