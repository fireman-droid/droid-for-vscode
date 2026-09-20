import type { HTMLAttributes, ReactNode } from 'react';

export function ChatLayout({ header, footer, overlay, children, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  readonly header: ReactNode;
  readonly footer: ReactNode;
  readonly overlay?: ReactNode;
}) {
  return <main {...props} className={`v2-chat-surface relative grid h-full min-w-0 flex-1 grid-rows-[40px_minmax(0,1fr)_auto] ${props.className ?? ''}`}>
    <header className="flex min-w-0 items-center justify-between border-b border-[var(--panel-edge)] px-3 py-1">{header}</header>
    {children}
    <footer className="v2-chat-footer space-y-2">{footer}</footer>
    {overlay}
  </main>;
}
