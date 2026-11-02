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
  const nextEditId = useId();
  const advancedId = useId();
  useEffect(() => { setDraft(settings.completion); }, [settings.completion]);
  const normalize = (next: CompletionPreferences): CompletionPreferences => ({
    ...next,
    model: next.model.trim() || settings.completion.model,
    endpoint: next.endpoint.trim() || settings.completion.endpoint,
    debounceMs: Number.isFinite(next.debounceMs) ? Math.min(2000, Math.max(100, Math.round(next.debounceMs))) : settings.completion.debounceMs,
    nextEdit: {
      ...next.nextEdit,
      model: next.nextEdit.model.trim() || settings.completion.nextEdit.model,
      endpoint: next.nextEdit.endpoint.trim() || settings.completion.nextEdit.endpoint,
    },
  });
  const commit = (next: CompletionPreferences, setApiKey = false, setNextEditApiKey = false) => {
    if (state.busy) return;
    const normalized = normalize(next);
    setDraft(normalized);
    void state.run({ kind: 'completion.save', preferences: normalized, setApiKey, setNextEditApiKey }).then(result => {
      if (result.ok && result.settings) setDraft(result.settings.completion);
    });
  };
  const commitIfChanged = (next = draft) => {
    const c = settings.completion;
    const n = normalize(next);
    setDraft(n);
    if (n.enabled === c.enabled && n.fimEnabled === c.fimEnabled && n.protocol === c.protocol
      && n.model === c.model && n.endpoint === c.endpoint && n.autoTrigger === c.autoTrigger
      && n.relatedFiles === c.relatedFiles && n.adaptiveDebounce === c.adaptiveDebounce
      && n.debounceMs === c.debounceMs && n.nextEdit.enabled === c.nextEdit.enabled
      && n.nextEdit.model === c.nextEdit.model && n.nextEdit.endpoint === c.nextEdit.endpoint) return;
    commit(n);
  };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
  };
  const toggle = (key: 'enabled' | 'fimEnabled' | 'autoTrigger' | 'relatedFiles' | 'adaptiveDebounce', label: string) =>
    <Switch aria-label={label} checked={draft[key]} disabled={state.busy} onCheckedChange={value => commit({ ...draft, [key]: value })} />;
  const hasFimKey = draft.endpoint.trim() === settings.completion.endpoint && settings.completionHasKey;
  const hasNextEditKey = draft.nextEdit.endpoint.trim() === settings.completion.nextEdit.endpoint && settings.nextEditHasKey;
  return <section aria-label={t("智能补全配置")}>
    <header className="management-heading"><div><h1>{t("智能补全")}</h1><p>{t("独立于聊天模型")}</p></div></header>
    <div>
      <SettingsSection>
        <ManagementRow label={t("启用智能补全")} detail={t("启用后，将编辑上下文发送到下方服务。")}>{toggle('enabled', t('启用智能补全'))}</ManagementRow>
      </SettingsSection>
      <SettingsSection title={t("代码续写")}>
        <ManagementRow label={t("启用代码续写")} detail={t("在光标处补充代码，使用 FIM 模型。")}>{toggle('fimEnabled', t('启用代码续写'))}</ManagementRow>
        <ManagementRow label={t("协议")}><ManagementChoice label={t("补全协议")} className="management-choice-wide" value={draft.protocol} disabled={state.busy} onChange={v => commit({ ...draft, protocol: v as CompletionPreferences['protocol'] })}
          options={[[ 'fim', t('FIM · 代码续写') ], ['ollama', 'Ollama FIM'], ['siliconflow-fim', 'SiliconFlow FIM']]} /></ManagementRow>
        <ManagementRow label={t("模型 ID")}><Input aria-label={t("补全模型 ID")} value={draft.model} disabled={state.busy} required maxLength={256}
          onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
        <ManagementRow label={t("API 地址")}><Input type="url" aria-label={t("补全 API 地址")} value={draft.endpoint} disabled={state.busy} required maxLength={2048}
          onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
        <ManagementRow label="API Key" detail={hasFimKey ? t("已配置") : t("未确认配置")}>
          <Button variant="outline" size="sm" disabled={state.busy} onClick={() => commit(draft, true, false)}>{t(hasFimKey ? "更新密钥" : "设置密钥")}</Button>
        </ManagementRow>
      </SettingsSection>
      <SettingsSection title={t("下一步编辑")}>
        <ManagementRow label={t("启用 Next Edit")} detail={t("预测替换、删除及后续修改。需单独配置编辑预测模型，可与代码续写同时启用。") }>
          <Switch aria-label={t("启用 Next Edit")} aria-controls={nextEditId} checked={draft.nextEdit.enabled} disabled={state.busy}
            onCheckedChange={enabled => commit({ ...draft, nextEdit: { ...draft.nextEdit, enabled } })} />
        </ManagementRow>
        <AnimatedCollapsibleContent id={nextEditId} open={draft.nextEdit.enabled} className="management-collapsible-rows">
          <ManagementRow label={t("模型 ID")}><Input aria-label={t("Next Edit 模型 ID")} value={draft.nextEdit.model} disabled={state.busy} required maxLength={256}
            onChange={e => setDraft(prev => ({ ...prev, nextEdit: { ...prev.nextEdit, model: e.target.value } }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
          <ManagementRow label={t("API 地址")}><Input type="url" aria-label={t("Next Edit API 地址")} value={draft.nextEdit.endpoint} disabled={state.busy} required maxLength={2048}
            onChange={e => setDraft(prev => ({ ...prev, nextEdit: { ...prev.nextEdit, endpoint: e.target.value } }))} onBlur={() => commitIfChanged()} onKeyDown={onInputKeyDown} /></ManagementRow>
          <ManagementRow label="API Key" detail={hasNextEditKey ? t("已配置") : t("未确认配置")}>
            <Button variant="outline" size="sm" disabled={state.busy} onClick={() => commit(draft, false, true)}>{t(hasNextEditKey ? "更新密钥" : "设置密钥")}</Button>
          </ManagementRow>
        </AnimatedCollapsibleContent>
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
