import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { matchesModelSource } from '../../shared/protocol/modelSourceProtocol';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/controls';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { ModelSourceControl, ModelSourceEmpty, ModelSourceNotice, useModelSource } from './ModelSourceControl';

interface ModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly isCustom?: boolean;
  readonly disabled?: boolean;
  readonly description?: string;
}

export function ModelSourceSelect({ label, value, models, disabled, onChange,
  placeholder = 'Choose an available model', className = '', side = 'bottom', align = 'start', valueSuffix, footer }: {
  readonly label: string;
  readonly value: string | undefined;
  readonly models: readonly ModelOption[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly side?: 'top' | 'bottom';
  readonly align?: 'start' | 'end';
  readonly valueSuffix?: string;
  readonly footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { mode } = useModelSource();
  const selected = models.find((model) => model.id === value);
  const visible = models.filter((model) => matchesModelSource(model, mode));
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled} aria-label={label}
        title={selected?.displayName ?? value}
        className={`h-8 w-full min-w-0 justify-between gap-2 bg-input-background px-2 font-normal ${className}`}>
        <span className="truncate">{selected?.displayName ?? value ?? placeholder}</span>
        {valueSuffix ? <span className="shrink-0 text-muted-foreground">{valueSuffix}</span> : null}
        <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent aria-label={label} side={side} align={align} className="flex max-h-[min(360px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[min(240px,calc(100vw-16px))] max-w-[calc(100vw-16px)] flex-col gap-2 p-2">
      <ModelSourceControl models={models} />
      <ModelSourceNotice model={selected} />
      {visible.length === 0 ? <ModelSourceEmpty /> : (
        <RadioGroup aria-label={`${label} options`} value={value ?? ''} className="min-h-0 overflow-y-auto"
          onValueChange={(next) => { if (next !== value) onChange(next); setOpen(false); }}>
          {visible.map((model) => <RadioGroupItem key={model.id} value={model.id} disabled={model.disabled} onClick={() => setOpen(false)}
            className="dvx-menu-item flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs">
            <span className="min-w-0">
              <span className="block break-words">{model.displayName}</span>
              <span className="block break-words text-[11px] text-muted-foreground">
                {model.isCustom === undefined ? '来源未知' : model.isCustom ? 'BYOK' : '官方'}
                {model.description ? ` · ${model.description}` : ''}
              </span>
            </span>
            {model.id === value ? <Check aria-hidden="true" className="size-3 shrink-0" /> : null}
          </RadioGroupItem>)}
        </RadioGroup>
      )}
      {footer}
    </PopoverContent>
  </Popover>;
}
