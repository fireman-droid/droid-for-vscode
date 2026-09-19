import { useEffect, useState } from 'react';

import { Diagnostic } from '../thread/transcriptRows';
import { TRANSIENT_NOTICE_TIMEOUT_MS, type TransientDiagnostic } from './transientDiagnostic';
export {
  TRANSIENT_NOTICE_TIMEOUT_MS,
  isTransientNoticeLifecycleMessage,
  reduceTransientDiagnostic,
  selectVisibleNotice,
  type TransientDiagnostic,
  type TransientNoticeLifecycleMessage,
} from './transientDiagnostic';

/** Short-lived interaction feedback that never enters assistant-ui history. */
export function TransientNotice({
  diagnostic,
}: {
  readonly diagnostic: TransientDiagnostic;
}): React.JSX.Element | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), TRANSIENT_NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  return visible ? <Diagnostic data={diagnostic} /> : null;
}
