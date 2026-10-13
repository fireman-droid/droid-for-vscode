import { useI18n } from '@droidvisx/chat-ui/i18n';
import { ModelPicker, type ModelPickerProps, type PickerModel } from '@droidvisx/chat-ui/ui/model-picker';
import { matchesModelSource } from '../../shared/protocol/modelSourceProtocol';
import { useModelSource } from './ModelSourceControl';

export interface SettingsPickerModel extends PickerModel {
  readonly isCustom?: boolean;
  /** Semantic choices such as "current session model" are not catalog entries. */
  readonly sourceIndependent?: boolean;
}

export function SettingsModelPicker({ models, ...props }: Omit<ModelPickerProps, 'models' | 'visibleModelIds'> & { models: readonly SettingsPickerModel[] }) {
  const { t } = useI18n();
  const { mode } = useModelSource();
  return <ModelPicker {...props}
    models={models.map(model => ({ ...model, source: model.isCustom === undefined ? undefined : model.isCustom ? 'BYOK' : t('官方') }))}
    visibleModelIds={models.filter(model => model.sourceIndependent || matchesModelSource(model, mode)).map(model => model.id)} />;
}
