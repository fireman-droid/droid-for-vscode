import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from './input';
import { cn } from './cn';

/** Search and filters share one row, wrapping without squeezing the input. */
export function ListToolbar({ label, placeholder, value, onChange, children, className }: {
  label: string; placeholder?: string; value: string; onChange: (value: string) => void;
  children?: ReactNode; className?: string;
}) {
  return <div className={cn('dvx-list-toolbar', className)}>
    <div className="dvx-list-search"><Search aria-hidden="true" />
      <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />
    </div>
    {children && <div className="dvx-list-filters">{children}</div>}
  </div>;
}
