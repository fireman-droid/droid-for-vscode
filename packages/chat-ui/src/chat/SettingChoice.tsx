import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
export function SettingChoice<Value extends string>({ label, value, options, disabled, placeholder, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { value: Value; label: string }[];
  readonly disabled: boolean;
  readonly placeholder?: string;
  readonly onChange: (value: Value) => void;
}) {
  return <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2">
    <span className="text-xs text-muted-foreground">{label}</span>
    <Select value={value} disabled={disabled} onValueChange={(next) => {
      if (next !== value) onChange(next as Value);
    }}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder}>{value === '' ? undefined : options.find((item) => item.value === value)?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

