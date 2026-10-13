import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SESSION_INTERACTION_MODES } from '../../shared/protocol/bounds';
import type { DefaultsScope } from '../../shared/protocol/managementDefaultsProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { useDefaultSettings } from './useDefaultSettings';
import { DefaultsSelect, useDefaultsFields, type DefaultsFieldsProps } from './DefaultsFields';
import { CompactionDefaults } from './CompactionDefaults';
import { SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import type { ManagementState } from './useManagement';

export function DefaultsSettings({ state, scope, active }: { state: ManagementState; scope: DefaultsScope; active: boolean }) {
  const { t } = useI18n();
  const form = useDefaultSettings(state, scope, active);
  return <section className="management-defaults" aria-label={scope === 'sessions' ? t("会话默认设置") : t("Mission 默认设置")}>
    <div className="management-defaults-intro"><p>{t("应用于新建")}{scope === 'sessions' ? t("会话") : t("任务")}{t("，不切换当前聊天。")}</p>
      <Button variant="plain" size="icon-sm" aria-label={t("刷新默认设置")} disabled={state.busy || form.dirty} onClick={() => void form.read()}><RefreshCw /></Button>
    </div>
    {form.snapshot ? <form onSubmit={e => { e.preventDefault(); void form.save(); }}>
      {scope === 'sessions' ? <SessionDefaults snapshot={form.snapshot} values={form.values} busy={state.busy} update={form.update} />
        : <MissionDefaults snapshot={form.snapshot} values={form.values} busy={state.busy} update={form.update} />}
      <footer className="management-form-actions">
        <Button variant="plain" size="sm" disabled={state.busy || !form.dirty} onClick={form.reset}>{t("撤销修改")}</Button>
        <Button variant="outline" size="sm" type="submit" disabled={state.busy || !form.valid}>{form.saving ? t("保存中…") : t("保存")}</Button>
      </footer>
      {form.dirty && !form.valid && <p role="alert" className="management-caption text-destructive">{t("Token 上限需要填写正整数。")}</p>}
    </form> : !form.error && <p role="status" className="management-empty">{t("正在读取默认设置…")}</p>}
    {form.error && <p role="alert" className="management-caption text-destructive">{form.error}</p>}
  </section>;
}

function SessionDefaults(props: DefaultsFieldsProps) {
  const { t } = useI18n();
  const f = useDefaultsFields(props);
  const [tier, setTier] = useState('light');
  const levels = props.snapshot.autonomyLevels ?? [];
  const levelNames: Record<string, string> = { off: '关闭', low: '低', medium: '中', high: '高', inherit: '跟随主会话' };
  return <>
    <SettingsSection>
      {f.modelPair('modelId', 'reasoningEffort', '默认模型', '默认推理强度')}
      {f.choice('interactionMode', '默认交互模式', SESSION_INTERACTION_MODES.map(value => ({ value, label: { auto: 'Auto', spec: 'Spec', mission: 'Mission' }[value] })))}
      {f.choice('autonomyLevel', '默认自主等级', levels.map(value => ({ value, label: levelNames[value] ?? value })))}
    </SettingsSection>
    <SettingsSection title={t("Spec 模式")}>
      {f.modelPair('specModeModelId', 'specModeReasoningEffort', 'Spec 模型', 'Spec 推理强度', true)}
      {f.row('specSaveDir', '计划保存目录', <SpecDirectoryField value={f.text('specSaveDir')} options={props.snapshot.specDirectories}
        disabled={f.disabled('specSaveDir')} onChange={value => props.update({ specSaveDir: value })} />)}
    </SettingsSection>
    <CompactionDefaults {...props} />
    <SettingsSection title={t("子任务模型")}>
      {f.choice('subagentAutonomyLevel', '子任务自主等级', [...levels, 'inherit'].map(value => ({ value, label: levelNames[value] ?? value })), true)}
      <Tabs value={tier} onValueChange={setTier} className="management-default-tier">
        <TabsList animatedIndicator aria-label={t("子任务复杂度")}><TabsTrigger value="light">{t("轻量")}</TabsTrigger><TabsTrigger value="medium">{t("中等")}</TabsTrigger><TabsTrigger value="heavy">{t("复杂")}</TabsTrigger></TabsList>
        {(['light', 'medium', 'heavy'] as const).map(t => <TabsContent key={t} value={t}>
          {f.modelPair(`subagentModelSettings.${t}Model`, `subagentModelSettings.${t}ReasoningEffort`)}
        </TabsContent>)}
      </Tabs>
    </SettingsSection>
  </>;
}

function SpecDirectoryField({ value, options, disabled, onChange }: {
  value?: string; options: DefaultsFieldsProps['snapshot']['specDirectories']; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const { t } = useI18n();
  // Keep custom mode while editing (including an empty path), but let reset values select their preset again.
  const [customDraft, setCustomDraft] = useState<{ value?: string } | null>(null);
  const custom = Boolean(value && !options.some(option => option.value === value)) || (customDraft !== null && customDraft.value === value);
  const defaultOption = '__droid_default__';
  const customOption = '__droid_custom__';
  return <div className="management-default-directory">
    <DefaultsSelect label={t("计划保存目录")} value={custom ? customOption : value || defaultOption} disabled={disabled}
      options={[{ value: defaultOption, label: t('Droid 默认') }, ...options, { value: customOption, label: t('自定义') }]}
      onChange={next => {
        if (next === customOption) setCustomDraft({ value });
        else { setCustomDraft(null); onChange(next === defaultOption ? null : next); }
      }} />
    {custom && <Input aria-label={t("自定义计划保存目录")} placeholder={t("输入目录路径")} value={value ?? ''} maxLength={2048} disabled={disabled}
      onChange={event => {
        const next = event.target.value.trim() || undefined;
        setCustomDraft({ value: next });
        onChange(next ?? null);
      }} />}
  </div>;
}

function MissionDefaults(props: DefaultsFieldsProps) {
  const { t } = useI18n();
  const f = useDefaultsFields(props);
  return <>
    <SettingsSection>{f.modelPair('missionOrchestratorModel', 'missionOrchestratorReasoningEffort', '编排者模型', '编排者推理强度', true)}</SettingsSection>
    <SettingsSection title={t("执行与验证")}>
      {f.modelPair('missionModelSettings.workerModel', 'missionModelSettings.workerReasoningEffort', '执行者模型', '执行者推理强度')}
      {f.modelPair('missionModelSettings.validationWorkerModel', 'missionModelSettings.validationWorkerReasoningEffort', '验证者模型', '验证者推理强度')}
    </SettingsSection>
    <SettingsSection title={t("里程碑验证")}>
      {f.toggle('missionModelSettings.skipScrutiny', '跳过审查', '跳过里程碑结束时的审查验证。')}
      {f.toggle('missionModelSettings.skipUserTesting', '跳过用户测试', '跳过里程碑结束时的用户测试验证。')}
    </SettingsSection>
  </>;
}
