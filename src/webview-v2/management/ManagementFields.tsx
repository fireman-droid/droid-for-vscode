import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';

export function ManagementChoice({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[]; disabled?: boolean;
}) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent className="management-menu">
    {options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}
  </SelectContent></Select>;
}
export function ManagementRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return <div className="management-row"><div>{label}{detail && <small>{detail}</small>}</div><div className="management-row-control">{children}</div></div>;
}
