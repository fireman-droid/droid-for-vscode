import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { TRANSIENT_NOTICE_TIMEOUT_MS, type TransientDiagnostic } from '../host/transientDiagnostic';

export function TransientNotice({ diagnostic }: { readonly diagnostic: TransientDiagnostic }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (diagnostic.code === 'turn-stop-unconfirmed') return;
    const timer = setTimeout(() => setVisible(false), TRANSIENT_NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [diagnostic.code]);
  return visible ? <p role="status" className="text-xs text-muted-foreground">{t(diagnostic.message)}</p> : null;
}
