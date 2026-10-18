import { WrapText } from 'lucide-react';
import { useI18n } from '../i18n';
import { Toggle } from '../ui/controls';

export function CodeWrapToggle({ wrapped, onChange }: {
  readonly wrapped: boolean; readonly onChange: (wrapped: boolean) => void;
}) {
  const { t } = useI18n();
  return <Toggle pressed={wrapped} onPressedChange={onChange} aria-label={t('Word wrap')}
    title={t(wrapped ? 'Disable word wrap' : 'Enable word wrap')}><WrapText /></Toggle>;
}
