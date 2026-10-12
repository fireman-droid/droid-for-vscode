import { useI18n } from '@droidvisx/chat-ui/i18n';
import type { ReactNode } from 'react';
import type { DefaultField, DefaultValue, DefaultValues, ManagementDefaults } from '../../shared/protocol/managementDefaultsProtocol';
import { Switch } from '../ui/controls';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { ManagementRow } from './ManagementFields';

const DEFAULT = '__droid_default__';
export interface DefaultsFieldsProps {
  snapshot: ManagementDefaults;
  values: DefaultValues;
  busy: boolean;
  update: (changes: DefaultValues) => void;
}
interface Option { value: string; label: string; disabled?: boolean }
export function DefaultsSelect({ label, value, options, disabled, onChange, placeholder = 'Droid 默认', wide = false }: {
  label: string; value?: string; options: readonly Option[]; disabled?: boolean; onChange: (value: string) => void; placeholder?: string; wide?: boolean;
}) {
  const { t } = useI18n();
  const items = value && !options.some(o => o.value === value) ? [{ value, label: value, disabled: true }, ...options] : options;
  return <Select value={value ?? ''} disabled={disabled} onValueChange={onChange}>
    <SelectTrigger aria-label={t(label)} className={`management-default-choice${wide ? ' management-default-choice-wide' : ''}`}><SelectValue placeholder={t(placeholder)} /></SelectTrigger>
    <SelectContent className="management-menu" align="end">{items.map(o => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}</SelectContent>
  </Select>;
}
export function useDefaultsFields(props: DefaultsFieldsProps) {
  const { t } = useI18n();
  const { snapshot, values, busy, update } = props;
  const text = (key: DefaultField) => typeof values[key] === 'string' ? values[key] as string : undefined;
  const disabled = (key: DefaultField) => busy || Boolean(snapshot.locked[key]);
  const row = (key: DefaultField, label: string, control: ReactNode, detail?: string) =>
    <ManagementRow key={key} label={label} detail={snapshot.locked[key] || detail}>{control}</ManagementRow>;
  const choice = (key: DefaultField, label: string, options: readonly Option[], nullable = false) => row(key, label,
    <DefaultsSelect label={label} wide={key === 'compactionModel'} value={text(key) ?? (nullable ? DEFAULT : undefined)} disabled={disabled(key) || options.length === 0}
      options={[...(nullable ? [{ value: DEFAULT, label: t('Droid 默认') }] : []),
        ...options.map(o => ({ ...o, label: key === 'compactionModel' ? o.label : t(o.label) }))]}
      onChange={value => update({ [key]: value === DEFAULT ? null : value })} />);
  const toggle = (key: DefaultField, label: string, detail?: string) => row(key, label,
    <span className="management-default-toggle">{values[key] === undefined && <small>{t("默认")}</small>}
      <Switch aria-label={t(label)} checked={values[key] === true} disabled={disabled(key)} onCheckedChange={value => update({ [key]: value })} />
    </span>, detail);
  const number = (key: DefaultField, label: string) => row(key, label,
    <Input type="number" aria-label={t(label)} min={1} step={1} placeholder={t("Droid 默认")} disabled={disabled(key)}
      value={typeof values[key] === 'number' && Number.isFinite(values[key]) ? values[key] as number : ''}
      onChange={e => update({ [key]: e.target.value === '' ? NaN : Number(e.target.value) })} />);
  const modelOptions = snapshot.models.map(m => ({ value: m.id, label: m.label, disabled: Boolean(m.disabledReason) }));
  const modelPair = (modelKey: DefaultField, effortKey: DefaultField, modelLabel = '模型', effortLabel = '推理强度', nullable = false) => {
    const model = snapshot.models.find(m => m.id === text(modelKey));
    const options = nullable ? [{ value: DEFAULT, label: t('Droid 默认') }, ...modelOptions] : modelOptions;
    return <>
      {row(modelKey, modelLabel, <DefaultsSelect label={modelLabel} wide value={text(modelKey) ?? (nullable ? DEFAULT : undefined)}
        options={options} disabled={disabled(modelKey) || !modelOptions.length} onChange={id => {
          const next = snapshot.models.find(m => m.id === id);
          const changes: Partial<Record<DefaultField, DefaultValue>> = { [modelKey]: id === DEFAULT ? null : id };
          if (!snapshot.locked[effortKey]) {
            if (id === DEFAULT && nullable) changes[effortKey] = null;
            else if (next) changes[effortKey] = next.defaultReasoning;
          }
          update(changes);
        }} />, model?.disabledReason)}
      {row(effortKey, effortLabel, <DefaultsSelect label={effortLabel} value={text(effortKey) ?? (nullable ? DEFAULT : undefined)}
        disabled={disabled(effortKey) || !model?.reasoning.length || Boolean(model.disabledReason)}
        options={[...(nullable ? [{ value: DEFAULT, label: t('Droid 默认') }] : []), ...(model?.reasoning ?? []).map(value => ({ value, label: t(value.charAt(0).toUpperCase() + value.slice(1)) }))]}
        onChange={value => update({ [effortKey]: value === DEFAULT ? null : value })} />)}
    </>;
  };
  return { text, disabled, row, choice, toggle, number, modelPair, modelOptions };
}
