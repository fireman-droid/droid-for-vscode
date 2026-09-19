import { useEffect, useState } from 'react';
import { TRANSIENT_NOTICE_TIMEOUT_MS, type TransientDiagnostic } from '../../webview/assistant/shell/transientDiagnostic';

export function TransientNotice({ diagnostic }: { readonly diagnostic: TransientDiagnostic }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), TRANSIENT_NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <p role="status" className="text-xs text-muted-foreground">{diagnostic.message}</p> : null;
}
