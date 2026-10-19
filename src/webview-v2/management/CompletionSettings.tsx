import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CompletionPreferences, ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/selection';
import { Switch } from '../ui/controls';
import { SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ManagementChoice, ManagementRow } from './ManagementFields';
import type { ManagementState } from './useManagement';

export function CompletionSettings({ state, settings }: { state: ManagementState; settings: ManagementSettings }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(settings.completion);
  const [dirty, setDirty] = useState(false);
  const [setApiKey, setSetApiKey] = useState(false);
  const [setNextEditApiKey, setSetNextEditApiKey] = useState(false);
  useEffect(() => { if (!dirty) setDraft(settings.completion); }, [settings.completion, dirty]);
  const update = <K extends keyof CompletionPreferences>(key: K, value: CompletionPreferences[K]) => {
    setDraft(prev => ({ ...prev, [key]: value })); setDirty(true);
  };
  const toggle = (key: 'enabled' | 'fimEnabled' | 'autoTrigger' | 'relatedFiles' | 'adaptiveDebounce', label: string) =>
    <Switch aria-label={label} checked={draft[key]} disabled={state.busy} onCheckedChange={value => update(key, value)} />;
  return <section aria-label={t("智能补全配置")}>
    <header className="management-heading"><div><h1>{t("智能补全")}</h1><p>{t("独立于聊天模型")}</p></div></header>
    <form onSubmit={event => { event.preventDefault(); if (state.busy) return;
      void state.run({ kind: 'completion.save', preferences: draft, setApiKey, setNextEditApiKey }).then(result => {
        if (result.ok && result.settings) { setDraft(result.settings.completion); setDirty(false); setSetApiKey(false); setSetNextEditApiKey(false); }
      });
    }}>
      <SettingsSection>
        <ManagementRow label={t("启用智能补全")} detail={t("启用后，将编辑上下文发送到下方服务。")}>{toggle('enabled', t('启用智能补全'))}</ManagementRow>
      </SettingsSection>
      <SettingsSection title={t("代码续写")}>
        <ManagementRow label={t("启用代码续写")} detail={t("在光标处补充代码，使用 FIM 模型。")}>{toggle('fimEnabled', t('启用代码续写'))}</ManagementRow>
        <ManagementRow label={t("协议")}><ManagementChoice label={t("补全协议")} className="management-choice-wide" value={draft.protocol} disabled={state.busy} onChange={v => update('protocol', v as CompletionPreferences['protocol'])}
          options={[[ 'fim', t('FIM · 代码续写') ], ['ollama', 'Ollama FIM'], ['siliconflow-fim', 'SiliconFlow FIM']]} /></ManagementRow>
        <ManagementRow label={t("模型 ID")}><Input aria-label={t("补全模型 ID")} value={draft.model} disabled={state.busy} required maxLength={256} onChange={e => update('model', e.target.value)} /></ManagementRow>
        <ManagementRow label={t("API 地址")}><Input type="url" aria-label={t("补全 API 地址")} value={draft.endpoint} disabled={state.busy} required maxLength={2048} onChange={e => update('endpoint', e.target.value)} /></ManagementRow>
        <ManagementRow label="API Key" detail={draft.endpoint === settings.completion.endpoint && settings.completionHasKey ? t("已配置") : t("未确认配置")}>
          <label className="management-check"><Checkbox checked={setApiKey} disabled={state.busy} onCheckedChange={v => { setSetApiKey(v === true); }} />{t("保存时设置密钥")}</label>
        </ManagementRow>
      </SettingsSection>
      <SettingsSection title={t("下一步编辑")}>
        <ManagementRow label={t("启用 Next Edit")} detail={t("预测替换、删除及后续修改。需单独配置编辑预测模型，可与代码续写同时启用。") }>
          <Switch aria-label={t("启用 Next Edit")} checked={draft.nextEdit.enabled} disabled={state.busy} onCheckedChange={enabled => update('nextEdit', { ...draft.nextEdit, enabled })} />
        </ManagementRow>
        {draft.nextEdit.enabled && <>
          <ManagementRow label={t("模型 ID")}><Input aria-label={t("Next Edit 模型 ID")} value={draft.nextEdit.model} disabled={state.busy} required maxLength={256} onChange={e => update('nextEdit', { ...draft.nextEdit, model: e.target.value })} /></ManagementRow>
          <ManagementRow label={t("API 地址")}><Input type="url" aria-label={t("Next Edit API 地址")} value={draft.nextEdit.endpoint} disabled={state.busy} required maxLength={2048} onChange={e => update('nextEdit', { ...draft.nextEdit, endpoint: e.target.value })} /></ManagementRow>
          <ManagementRow label="API Key" detail={draft.nextEdit.endpoint === settings.completion.nextEdit.endpoint && settings.nextEditHasKey ? t("已配置") : t("未确认配置")}>
            <label className="management-check"><Checkbox checked={setNextEditApiKey} disabled={state.busy} onCheckedChange={v => setSetNextEditApiKey(v === true)} />{t("保存时设置密钥")}</label>
          </ManagementRow>
        </>}
      </SettingsSection>
      <SettingsSection title={t("触发与上下文")}>
        <ManagementRow label={t("输入时自动触发")}>{toggle('autoTrigger', t('输入时自动触发'))}</ManagementRow>
        <ManagementRow label={t("关联文件上下文")}>{toggle('relatedFiles', t('关联文件上下文'))}</ManagementRow>
      </SettingsSection>
      <Collapsible><CollapsibleTrigger asChild><Button variant="plain" size="sm" className="management-advanced">{t("高级")} <ChevronDown /></Button></CollapsibleTrigger><CollapsibleContent>
        <SettingsSection><ManagementRow label={t("自适应延迟")}>{toggle('adaptiveDebounce', t('自适应延迟'))}</ManagementRow>
          <ManagementRow label={t("基础延迟（ms）")}><Input type="number" aria-label={t("基础延迟（ms）")} min={100} max={2000} step={50} value={draft.debounceMs} disabled={state.busy} onChange={e => update('debounceMs', Number(e.target.value))} /></ManagementRow>
        </SettingsSection>
      </CollapsibleContent></Collapsible>
      <footer className="management-form-actions"><Button variant="outline" size="sm" type="submit" disabled={state.busy || !dirty && !setApiKey && !setNextEditApiKey}>{state.busy ? t("保存中…") : t("保存")}</Button></footer>
    </form>
  </section>;
}
