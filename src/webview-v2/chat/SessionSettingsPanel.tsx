import { useI18n, type Translate } from '@droidvisx/chat-ui/i18n';
import { useState } from 'react';
import { SESSION_AUTONOMY_LEVELS } from '../../shared/protocol/bounds';
import type { ModelCatalogState, SessionSettingsState } from '../../shared/protocol/settings';
import type { SessionSettingSelection } from './composer/useOptimisticSetting';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { matchesModelSource } from '../../shared/protocol/modelSourceProtocol';
import { ModelSourceEmpty, useModelSource } from '../models/ModelSourceControl';

export { SettingChoice } from '@droidvisx/chat-ui/chat/SettingChoice';
import { SettingChoice } from '@droidvisx/chat-ui/chat/SettingChoice';
const choices = <Value extends string,>(values: readonly Value[], t: Translate) =>
  values.map((value) => ({ label: t(value === 'xhigh' ? 'Extra High' : value.charAt(0).toUpperCase() + value.slice(1)), value }));

export function SessionSettingsPanel({ settings, catalog, disabled, onUpdate, onManageModels, onMissionOpen, missionActive = false }: {
  readonly settings: SessionSettingsState;
  readonly catalog: ModelCatalogState;
  readonly disabled: boolean;
  readonly onUpdate: (update: SessionSettingSelection) => void;
  readonly onManageModels: () => void;
  readonly onMissionOpen?: () => void;
  readonly missionActive?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [spec, setSpec] = useState(false);
  const { mode } = useModelSource();
  const confirmed = settings.value;
  const modelId = spec ? confirmed?.specModeModelId ?? confirmed?.modelId : confirmed?.modelId;
  const selected = catalog.items.find((model) => model.id === modelId);
  const normalized = query.trim().toLocaleLowerCase();
  const models = catalog.items.filter((model) => matchesModelSource(model, mode) && (
    model.displayName.toLocaleLowerCase().includes(normalized) || model.id.toLocaleLowerCase().includes(normalized)));
  const options = models.map((model) => ({ label: model.displayName, value: model.id, disabled: model.disabled,
    description: model.disabledReason ?? `${model.isCustom ? 'BYOK' : '官方'} · ${model.supportsImages ? 'Images' : 'Text only'}${model.supportsImageGeneration ? ' · Image generation' : ''}` }));
  if (selected && !models.some((model) => model.id === selected.id)) {
    options.unshift({ label: selected.displayName, value: selected.id, disabled: true, description: t('当前选择 · 不在筛选结果中') });
  }
  return <div className="space-y-2">
    {confirmed === null ? (
      <p role={settings.status === 'error' ? 'alert' : 'status'} className="text-xs text-muted-foreground">
        {settings.status === 'error' ? settings.message : t("Loading session settings…")}
      </p>
    ) : <>
      {!spec ? <>
        <SettingChoice label={t("Mode")} value={missionActive ? 'mission' : confirmed.interactionMode}
          options={choices((['auto', 'spec', 'mission'] as const).filter((value) => value !== 'mission' || onMissionOpen !== undefined), t)}
          disabled={disabled} onChange={(value) => {
            if (value === 'mission') onMissionOpen?.();
            else if (value !== confirmed.interactionMode) onUpdate({ field: 'interactionMode', value });
          }} />
        <SettingChoice label={t("Autonomy")} value={confirmed.autonomyLevel} options={choices(SESSION_AUTONOMY_LEVELS, t)} disabled={disabled} onChange={(value) => onUpdate({ field: 'autonomyLevel', value })} />
      </> : <h3 className="text-xs font-medium">{t("Spec drafting")}</h3>}
      <Input type="search" aria-label={t("Search models")} placeholder={t("Search models")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <SettingChoice
        label={spec ? t("Spec model") : t("Model")}
        value={spec ? confirmed.specModeModelId ?? '' : confirmed.modelId}
        placeholder={t("Same as session")}
        options={options}
        disabled={disabled || catalog.status !== 'ready'}
        onChange={(value) => onUpdate(spec ? { field: 'specModeModelId', value } : { field: 'modelId', value })}
      />
      <SettingChoice
        label={spec ? t("Spec reasoning") : t("Reasoning")}
        value={spec ? confirmed.specModeReasoningEffort ?? '' : confirmed.reasoningEffort}
        placeholder={t("Model default")}
        options={choices(selected?.supportedReasoningEfforts ?? [], t)}
        disabled={disabled || catalog.status !== 'ready' || selected?.disabled || !selected?.supportedReasoningEfforts.length}
        onChange={(value) => onUpdate(spec ? { field: 'specModeReasoningEffort', value } : { field: 'reasoningEffort', value })}
      />
      {spec ? <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="sm" disabled={disabled || confirmed.specModeModelId == null} onClick={() => onUpdate({ field: 'specModeModelId', value: null })}>{t("Use session model")}</Button>
        <Button variant="outline" size="sm" disabled={disabled || confirmed.specModeReasoningEffort == null} onClick={() => onUpdate({ field: 'specModeReasoningEffort', value: null })}>{t("Use model default")}</Button>
      </div> : null}
      {selected?.disabled ? <p role="status" className="text-xs text-muted-foreground">{selected.disabledReason}</p> : null}
      {catalog.status === 'ready' && models.length === 0 ? <ModelSourceEmpty /> : null}
      {catalog.status !== 'ready' ? <p role={catalog.status === 'error' ? 'alert' : 'status'} className="text-xs text-muted-foreground">{catalog.status === 'loading' ? t("Loading available models…") : catalog.message}</p> : null}
      <Button variant="ghost" size="sm" onClick={() => { setSpec(!spec); setQuery(''); }}>{spec ? t("Back to session settings") : t("Spec drafting…")}</Button>
      {settings.status === 'updating' ? <p role="status" className="text-xs text-muted-foreground">{t("Waiting for Droid to confirm settings…")}</p> : null}
      {settings.status === 'error' ? <p role="alert" className="text-xs text-destructive">{settings.message}</p> : null}
    </>}
    <Button variant="link" size="sm" onClick={onManageModels}>{t("Manage models…")}</Button>
  </div>;
}
