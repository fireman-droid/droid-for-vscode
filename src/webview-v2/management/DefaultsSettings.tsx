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
import type { ManagementState } from './useManagement';

export function DefaultsSettings({ state, scope, active }: { state: ManagementState; scope: DefaultsScope; active: boolean }) {
  const form = useDefaultSettings(state, scope, active);
  return <section className="management-defaults" aria-label={scope === 'sessions' ? '会话默认设置' : 'Mission 默认设置'}>
    <div className="management-defaults-intro"><p>应用于新建{scope === 'sessions' ? '会话' : '任务'}，不切换当前聊天。</p>
      <Button variant="plain" size="icon-sm" aria-label="刷新默认设置" disabled={state.busy || form.dirty} onClick={() => void form.read()}><RefreshCw /></Button>
    </div>
    {form.snapshot ? <form onSubmit={e => { e.preventDefault(); void form.save(); }}>
      {scope === 'sessions' ? <SessionDefaults snapshot={form.snapshot} values={form.values} busy={state.busy} update={form.update} />
        : <MissionDefaults snapshot={form.snapshot} values={form.values} busy={state.busy} update={form.update} />}
      <footer className="management-form-actions">
        <Button variant="plain" size="sm" disabled={state.busy || !form.dirty} onClick={form.reset}>撤销修改</Button>
        <Button variant="outline" size="sm" type="submit" disabled={state.busy || !form.valid}>{form.saving ? '保存中…' : '保存'}</Button>
      </footer>
      {form.dirty && !form.valid && <p role="alert" className="management-caption text-destructive">Token 上限需要填写正整数。</p>}
    </form> : !form.error && <p role="status" className="management-empty">正在读取默认设置…</p>}
    {form.error && <p role="alert" className="management-caption text-destructive">{form.error}</p>}
  </section>;
}

function SessionDefaults(props: DefaultsFieldsProps) {
  const f = useDefaultsFields(props);
  const [tier, setTier] = useState('light');
  const levels = props.snapshot.autonomyLevels ?? [];
  const levelNames: Record<string, string> = { off: '关闭', low: '低', medium: '中', high: '高', inherit: '跟随主会话' };
  return <>
    <div className="management-group">
      {f.modelPair('modelId', 'reasoningEffort', '默认模型', '默认推理强度')}
      {f.choice('interactionMode', '默认交互模式', SESSION_INTERACTION_MODES.map(value => ({ value, label: { auto: 'Auto', spec: 'Spec', mission: 'Mission' }[value] })))}
      {f.choice('autonomyLevel', '默认自主等级', levels.map(value => ({ value, label: levelNames[value] ?? value })))}
    </div>
    <h2 className="management-section-title">Spec 模式</h2><div className="management-group">
      {f.modelPair('specModeModelId', 'specModeReasoningEffort', 'Spec 模型', 'Spec 推理强度', true)}
      {f.row('specSaveDir', '计划保存目录', <div className="management-default-directory">
        {props.snapshot.specDirectories.length > 0 && <DefaultsSelect label="计划目录预设" value={props.snapshot.specDirectories.some(d => d.value === f.text('specSaveDir')) ? f.text('specSaveDir') : undefined}
          placeholder="选择目录" options={props.snapshot.specDirectories} disabled={f.disabled('specSaveDir')} onChange={value => props.update({ specSaveDir: value })} />}
        <Input aria-label="计划保存目录" placeholder="Droid 默认" value={f.text('specSaveDir') ?? ''} maxLength={2048} disabled={f.disabled('specSaveDir')}
          onChange={e => props.update({ specSaveDir: e.target.value.trim() || null })} />
      </div>)}
    </div>
    <CompactionDefaults {...props} />
    <h2 className="management-section-title">子任务模型</h2><div className="management-group">
      {f.choice('subagentAutonomyLevel', '子任务自主等级', [...levels, 'inherit'].map(value => ({ value, label: levelNames[value] ?? value })), true)}
      <Tabs value={tier} onValueChange={setTier} className="management-default-tier">
        <TabsList aria-label="子任务复杂度"><TabsTrigger value="light">轻量</TabsTrigger><TabsTrigger value="medium">中等</TabsTrigger><TabsTrigger value="heavy">复杂</TabsTrigger></TabsList>
        {(['light', 'medium', 'heavy'] as const).map(t => <TabsContent key={t} value={t}>
          {f.modelPair(`subagentModelSettings.${t}Model`, `subagentModelSettings.${t}ReasoningEffort`)}
        </TabsContent>)}
      </Tabs>
    </div>
  </>;
}

function MissionDefaults(props: DefaultsFieldsProps) {
  const f = useDefaultsFields(props);
  return <>
    <div className="management-group">{f.modelPair('missionOrchestratorModel', 'missionOrchestratorReasoningEffort', '编排者模型', '编排者推理强度', true)}</div>
    <h2 className="management-section-title">执行与验证</h2><div className="management-group">
      {f.modelPair('missionModelSettings.workerModel', 'missionModelSettings.workerReasoningEffort', '执行者模型', '执行者推理强度')}
      {f.modelPair('missionModelSettings.validationWorkerModel', 'missionModelSettings.validationWorkerReasoningEffort', '验证者模型', '验证者推理强度')}
    </div>
    <h2 className="management-section-title">里程碑验证</h2><div className="management-group">
      {f.toggle('missionModelSettings.skipScrutiny', '跳过审查', '跳过里程碑结束时的审查验证。')}
      {f.toggle('missionModelSettings.skipUserTesting', '跳过用户测试', '跳过里程碑结束时的用户测试验证。')}
    </div>
  </>;
}
