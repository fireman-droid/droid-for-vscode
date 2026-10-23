import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { matchesModelSource } from '../../shared/protocol/modelSourceProtocol';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { RadioGroup, RadioGroupItem } from '../ui/controls';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { ModelSourceEmpty, useModelSource } from './ModelSourceControl';

interface ModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly isCustom?: boolean;
  readonly disabled?: boolean;
  readonly description?: string;
}

export function ModelSourceSelect({ label, value, models, disabled, onChange,
  placeholder = 'Choose an available model', className = '', side = 'bottom', align = 'end' }: {
  readonly label: string;
  readonly value: string | undefined;
  readonly models: readonly ModelOption[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly side?: 'top' | 'bottom';
  readonly align?: 'start' | 'end';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { mode } = useModelSource();
  const selected = models.find((model) => model.id === value);
  const sourceModels = models.filter((model) => matchesModelSource(model, mode));
  const visible = sourceModels.filter(model => `${model.displayName} ${model.id} ${model.description ?? ''}`
    .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled} aria-label={label}
        title={selected?.displayName ?? value}
        className={`h-8 w-full min-w-0 justify-between gap-2 bg-input-background px-2 font-normal ${className}`}>
        <span className="truncate">{selected?.displayName ?? value ?? placeholder}</span>
        <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent aria-label={label} side={side} align={align} className="flex max-h-[min(360px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[min(240px,calc(100vw-16px))] max-w-[calc(100vw-16px)] flex-col gap-2 p-2">
      <div className="dvx-picker-search shrink-0"><Search aria-hidden="true" />
        <Input type="search" aria-label={t('搜索模型')} placeholder={t('搜索模型')} value={query}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
            event.preventDefault();
            const options = event.currentTarget.closest('[data-slot="popover-content"]')?.querySelectorAll<HTMLElement>('[role="radio"]:not([data-disabled])');
            options?.[event.key === 'ArrowUp' ? options.length - 1 : 0]?.focus();
          }} />
      </div>
      {visible.length === 0 ? sourceModels.length === 0 ? <ModelSourceEmpty />
        : <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{t('没有匹配的模型。')}</p> : (
        <RadioGroup aria-label={t("{p0} options", { p0: label })} value={value ?? ''} className="min-h-0 overflow-y-auto"
          onValueChange={(next) => { if (next !== value) onChange(next); setOpen(false); }}>
          {visible.map((model) => <RadioGroupItem key={model.id} value={model.id} disabled={model.disabled} onClick={() => setOpen(false)}
            className="dvx-menu-item flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs">
            <span className="min-w-0">
              <span className="block break-words">{model.displayName}</span>
              <span className="block break-words text-[11px] text-muted-foreground">
                {model.isCustom === undefined ? t("来源未知") : model.isCustom ? 'BYOK' : t("官方")}
                {model.description ? ` · ${model.description}` : ''}
              </span>
            </span>
            {model.id === value ? <Check aria-hidden="true" className="size-3 shrink-0" /> : null}
          </RadioGroupItem>)}
        </RadioGroup>
      )}
    </PopoverContent>
  </Popover>;
}
