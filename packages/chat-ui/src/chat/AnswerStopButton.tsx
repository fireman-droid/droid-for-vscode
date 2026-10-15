import { LoaderCircle, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from '../ui/button';

/** Shared by BTW and code questions; only the host confirms a stopped turn. */
export function AnswerStopButton({ stopping = false, onStop }: { stopping?: boolean; onStop(): void }) {
  const { t } = useI18n();
  return <Button variant="ghost" size="none" className="h-6 shrink-0 gap-1.5 rounded-md px-1.5 text-[11px] [&_svg]:size-3"
    disabled={stopping} aria-label={t(stopping ? 'Stopping…' : 'Stop answer')} onClick={onStop}>
    {stopping ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
      : <Square aria-hidden="true" className="size-2 fill-current" />}
    <span role="status">{t(stopping ? 'Stopping…' : 'Stop')}</span>
  </Button>;
}
