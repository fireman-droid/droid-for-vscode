import type { ModelCatalogState, SessionReasoningEffort } from '../../../shared/protocol/settings';
import { ModelSourceSelect } from '../../models/ModelSourceSelect';
import { RadioGroup, RadioGroupItem } from '../../ui/controls';
import { formatReasoningLabel } from '../composer/shared';

export interface BtwReasoningControl {
  readonly value: SessionReasoningEffort | undefined;
  readonly onChange: (effort: SessionReasoningEffort) => void;
}

export function BtwModelSelect({ catalog, value, disabled, onChange, reasoning }: {
  readonly catalog?: ModelCatalogState;
  readonly value?: string;
  readonly disabled: boolean;
  readonly onChange: (modelId: string) => void;
  readonly reasoning?: BtwReasoningControl;
}) {
  const models = catalog?.items ?? [];
  const model = models.find((item) => item.id === value);
  const efforts = model?.supportedReasoningEfforts ?? [];
  const showReasoning = reasoning !== undefined && efforts.length > 0;
  return <ModelSourceSelect label="Side conversation model" value={value} onChange={onChange}
    disabled={disabled || catalog?.status !== 'ready'} placeholder="Model" side="top" align="end"
    className="ml-auto h-7 w-auto max-w-[180px] flex-initial gap-1 border-0 bg-transparent px-1 text-xs"
    valueSuffix={showReasoning ? formatReasoningLabel(reasoning.value) : undefined}
    models={models.map((item) => ({ ...item,
      description: item.disabledReason ?? (item.supportsImages ? 'Images supported' : 'Text only') }))}
    footer={showReasoning ? <div className="shrink-0 space-y-2 border-t border-border pt-2">
      <p className="px-1 text-[11px] text-muted-foreground">Reasoning effort</p>
      <RadioGroup aria-label="Side conversation reasoning effort" value={reasoning.value}
        disabled={disabled || model?.disabled}
        onValueChange={(next) => {
          const effort = efforts.find((item) => item === next);
          if (effort !== undefined) reasoning.onChange(effort);
        }} className="flex flex-wrap gap-1">
        {efforts.map((effort) => <RadioGroupItem key={effort} value={effort}
          className="dvx-menu-item rounded px-2 py-1 text-xs data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground">
          {formatReasoningLabel(effort)}
        </RadioGroupItem>)}
      </RadioGroup>
    </div> : null} />;
}
