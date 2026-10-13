import { useI18n } from '@droidvisx/chat-ui/i18n';
import type { ReactNode } from 'react';
import { SettingsRow } from '@droidvisx/chat-ui/ui/settings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';

export function ManagementChoice({ label, value, onChange, options, disabled = false, className }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[]; disabled?: boolean; className?: string;
}) {
  const { t } = useI18n();
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={t(label)} className={className}><SelectValue /></SelectTrigger><SelectContent className="management-menu" align="end">
    {options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}
  </SelectContent></Select>;
}
export function ManagementRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  const { t } = useI18n();
  return <SettingsRow label={t(label)} detail={detail ? t(detail) : undefined} controlClassName="management-row-control">{children}</SettingsRow>;
}
