import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CompletionPreferences, ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/controls';
import { SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import { ManagementChoice, ManagementRow } from './ManagementFields';
import type { ManagementState } from './useManagement';

export function CompletionSettings({ state, settings }: { state: ManagementState; settings: ManagementSettings }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(settings.completion);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedId = useId();
  useEffect(() => { setDraft(settings.completion); }, [settings.completion]);
  const normalize = (next: CompletionPreferences): CompletionPreferences => ({
    ...next,
    model: next.model.trim() || settings.completion.model,
    endpoint: next.endpoint.trim() || settings.completion.endpoint,
    debounceMs: Number.isFinite(next.debounceMs) ? Math.min(2000, Math.max(100, Math.round(next.debounceMs))) : settings.completion.debounceMs,
  });
  const commit = (next: CompletionPreferences, setApiKey = false) => {
    if (state.busy) return;
    const normalized = normalize(next);
    setDraft(normalized);
    void state.run({ kind: 'completion.save', preferences: normalized, setApiKey }).then(result => {
      if (result.ok && result.settings) setDraft(result.settings.completion);
    });
  };
  const commitIfChanged = (next = draft) => {
    const c = settings.completion;
    const n = normalize(next);
    setDraft(n);
    if (n.enabled === c.enabled && n.protocol === c.protocol
      && n.model === c.model && n.endpoint === c.endpoint && n.autoTrigger === c.autoTrigger
      && n.relatedFiles === c.relatedFiles && n.adaptiveDebounce === c.adaptiveDebounce
      && n.debounceMs === c.debounceMs) return;
    commit(n);
  };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
  };
  const toggle = (key: 'enabled' | 'autoTrigger' | 'relatedFiles' | 'adaptiveDebounce', label: string) =>
    <Switch aria-label={label} checked={draft[key]} disabled={state.busy} onCheckedChange={value => commit({ ...draft, [key]: value })} />;
  const hasFimKey = draft.endpoint.trim() === settings.completion.endpoint && settings.completionHasKey;
  return <section aria-label={t("智能补全配置")}>
    <header className="management-heading"><div><h1>{t("智能补全")}</h1><p>{t("独立于聊天模型")}</p></div></header>
    <div>
      <SettingsSection>
        <ManagementRow label={t("启用智能补全")} detail={t("向下方 FIM 服务发送代码上下文，在光标处补充代码。")}>{toggle('enabled', t('启用智能补全'))}</ManagementRow>
      </SettingsSection>
      <SettingsSection title={t("代码续写")}>
        <ManagementRow label={t("协议")}><ManagementChoice label={t("补全协议")} className="management-choice-wide" value={draft.protocol} disabled={state.busy} onChange={v => commit({ ...draft, protocol: v as CompletionPreferences['protocol'] })}
          options={[[ 'fim', t('FIM · 代码续写') ], ['ollama', 'Ollama FIM'], ['siliconflow-fim', 'SiliconFlow FIM']]} /></ManagementRow>
        <ManagementRow label={t("模型 ID")}><Input aria-label={t("补全模型 ID")} value={draft.model} disabled={state.busy} required maxLength={256}
          onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
        <ManagementRow label={t("API 地址")}><Input type="url" aria-label={t("补全 API 地址")} value={draft.endpoint} disabled={state.busy} required maxLength={2048}
          onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
        <ManagementRow label="API Key" detail={hasFimKey ? t("已配置") : t("未确认配置")}>
          <Button variant="outline" size="sm" disabled={state.busy} onClick={() => commit(draft, true)}>{t(hasFimKey ? "更新密钥" : "设置密钥")}</Button>
        </ManagementRow>
      </SettingsSection>
      <SettingsSection title={t("触发与上下文")}>
        <ManagementRow label={t("输入时自动触发")}>{toggle('autoTrigger', t('输入时自动触发'))}</ManagementRow>
        <ManagementRow label={t("关联文件上下文")}>{toggle('relatedFiles', t('关联文件上下文'))}</ManagementRow>
      </SettingsSection>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild><Button variant="plain" size="sm" aria-controls={advancedId} className="management-advanced">{t("高级")} <ChevronDown /></Button></CollapsibleTrigger>
        <AnimatedCollapsibleContent id={advancedId} open={advancedOpen} className="management-advanced-content">
          <SettingsSection><ManagementRow label={t("自适应延迟")}>{toggle('adaptiveDebounce', t('自适应延迟'))}</ManagementRow>
            <ManagementRow label={t("基础延迟（ms）")}><Input type="number" aria-label={t("基础延迟（ms）")} min={100} max={2000} step={50} value={Number.isFinite(draft.debounceMs) ? draft.debounceMs : ''} disabled={state.busy}
              onChange={e => setDraft(prev => ({ ...prev, debounceMs: e.target.value === '' ? NaN : Number(e.target.value) }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
          </SettingsSection>
        </AnimatedCollapsibleContent>
      </Collapsible>
    </div>
  </section>;
}
