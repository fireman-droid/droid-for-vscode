import { LoaderCircle, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from '../ui/button';

/** Shared by BTW and code questions; only the host confirms a stopped turn. */
export function AnswerStopButton({ stopping = false, onStop, className }: { stopping?: boolean; onStop(): void; className?: string }) {
  const { t } = useI18n();
  return <Button variant="ghost" size="icon-sm" className={className}
    disabled={stopping} aria-busy={stopping} aria-label={t(stopping ? 'Stopping…' : 'Stop answer')}
    title={t(stopping ? 'Stopping…' : 'Stop answer')} onClick={onStop}>
    {stopping ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
      : <Square aria-hidden="true" className="size-2 fill-current" />}
  </Button>;
}
