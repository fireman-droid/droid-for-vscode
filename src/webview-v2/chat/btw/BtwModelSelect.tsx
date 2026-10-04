import { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ModelCatalogState, SessionReasoningEffort } from '../../../shared/protocol/settings';
import { Button } from '../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/overlays';
import { ModelPopover } from '../composer/ModelPopover';
import { formatReasoningLabel } from '../composer/shared';

export interface BtwReasoningControl {
  readonly value: SessionReasoningEffort | undefined;
  readonly onChange: (effort: SessionReasoningEffort) => void;
}

export function BtwModelSelect({ catalog, value, disabled, onChange, reasoning, onOpenModels }: {
  readonly catalog?: ModelCatalogState;
  readonly value?: string;
  readonly disabled: boolean;
  readonly onChange: (modelId: string) => void;
  readonly reasoning?: BtwReasoningControl;
  readonly onOpenModels?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pickerDisabled = disabled || catalog?.status !== 'ready';
  useEffect(() => { if (pickerDisabled) setOpen(false); }, [pickerDisabled]);
  const model = catalog?.items.find((item) => item.id === value);
  const name = model?.displayName ?? value ?? 'Model';
  const effort = model?.supportedReasoningEfforts.length ? reasoning?.value : undefined;
  const label = `${name}${effort ? ` ${formatReasoningLabel(effort)}` : ''}`;
  const close = () => setOpen(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" disabled={pickerDisabled}
        aria-label="Side conversation model" title={label}
        className="ml-auto h-[26px] w-auto min-w-0 max-w-[180px] flex-initial gap-1 px-1.5 text-xs font-normal text-muted-foreground data-[state=open]:bg-[var(--control-surface-active)] data-[state=open]:text-foreground">
        <span className="truncate">{label}</span><ChevronDown className="dvx-select-icon size-3 shrink-0" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={8}
      className="v2-composer-panel max-h-[min(520px,var(--radix-popover-content-available-height))] w-[240px] overflow-y-auto rounded-xl p-0">
      {catalog !== undefined ? <ModelPopover id={`${id}-model`} modelCatalog={catalog} disabled={disabled}
        selection={{ modelId: value, reasoningEffort: effort }}
        onUpdate={(update) => {
          if (update.field === 'modelId') onChange(update.value);
          else if (update.field === 'reasoningEffort') reasoning?.onChange(update.value);
          close();
        }} onManageModels={close} onOpenModels={onOpenModels} /> : null}
    </PopoverContent>
  </Popover>;
}
