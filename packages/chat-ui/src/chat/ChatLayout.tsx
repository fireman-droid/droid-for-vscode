import type { HTMLAttributes, ReactNode } from 'react';
import { StarfieldBackdrop } from './StarfieldBackdrop';

export function ChatLayout({ header, footer, overlay, starfield = false, children, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  readonly header: ReactNode;
  readonly footer: ReactNode;
  readonly overlay?: ReactNode;
  readonly starfield?: boolean;
}) {
  return <main {...props} className={`v2-chat-surface relative isolate grid h-full min-w-0 flex-1 grid-rows-[36px_minmax(0,1fr)_auto] ${props.className ?? ''}`}>
    {starfield ? <StarfieldBackdrop /> : null}
    <header className="relative z-[1] flex min-w-0 select-none items-center justify-between border-b border-[var(--panel-edge)] px-3 py-1">{header}</header>
    <div className="relative z-[1] grid min-h-0 min-w-0">
      {children}
      {overlay}
    </div>
    <footer className="v2-chat-footer relative z-[1] space-y-2">{footer}</footer>
  </main>;
}
