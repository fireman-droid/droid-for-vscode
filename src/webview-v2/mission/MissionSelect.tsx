import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { useEffect, useState } from 'react';

export function MissionSelect({ label, fieldLabel = label, value, options, disabled, onChange, placeholder = 'Choose an available value' }: {
  readonly label: string;
  readonly fieldLabel?: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled || options.length === 0) setOpen(false); }, [disabled, options.length]);
  return <label className="block min-w-0 space-y-1.5 text-xs"><span className="text-muted-foreground">{fieldLabel}</span>
    <Select open={open} onOpenChange={setOpen} value={options.some((item) => item.value === value) ? value : ''} disabled={disabled || options.length === 0} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-8 w-full rounded-md"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent aria-label={`${label} options`} className="max-h-52">
        {options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </label>;
}
