import { useAui } from '@assistant-ui/react';
import { useEffect, useRef } from 'react';

export function DraftSynchronizer({
  command,
}: {
  readonly command: { readonly id: number; readonly text: string };
}): null {
  const aui = useAui();
  const applied = useRef(-1);
  useEffect(() => {
    if (applied.current !== command.id) {
      applied.current = command.id;
      aui.thread.composer().setText(command.text);
      if (command.id > 0)
        document.getElementById('dvx-prompt')?.focus({ preventScroll: true });
    }
  }, [aui, command]);
  return null;
}
