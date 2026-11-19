import { createContext, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StarfieldBackdrop } from './StarfieldBackdrop';
import { ThreeBodyBackdrop } from './ThreeBodyBackdrop';

export type ChatBackdropKind = boolean | 'starfield' | 'three-body' | 'off';

export interface ChatFooterInsetStore {
  readonly getHeight: () => number;
  readonly subscribe: (listener: () => void) => () => void;
}

const NavigationHost = createContext<HTMLElement | null>(null);
const FooterInsetContext = createContext<ChatFooterInsetStore | null>(null);

export function ChatNavigationPortal({ children }: { readonly children: ReactNode }) {
  const host = useContext(NavigationHost);
  return host ? createPortal(children, host) : children;
}

export function useChatFooterInset(): ChatFooterInsetStore | null {
  return useContext(FooterInsetContext);
}

export function ChatLayout({ header, footer, overlay, starfield = false, children, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  readonly header: ReactNode;
  readonly footer: ReactNode;
  readonly overlay?: ReactNode;
  readonly starfield?: ChatBackdropKind;
}) {
  const [navigationHost, setNavigationHost] = useState<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const footerInsetRef = useRef<{
    height: number;
    listeners: Set<() => void>;
    store: ChatFooterInsetStore;
    setHeight: (next: number) => void;
  } | null>(null);
  if (footerInsetRef.current === null) {
    const state = {
      height: 0,
      listeners: new Set<() => void>(),
      store: {
        getHeight: () => state.height,
        subscribe: (listener: () => void) => {
          state.listeners.add(listener);
          return () => { state.listeners.delete(listener); };
        },
      },
      setHeight: (next: number) => {
        if (next === state.height) return;
        state.height = next;
        for (const listener of [...state.listeners]) listener();
      },
    };
    footerInsetRef.current = state;
  }
  const footerInset = footerInsetRef.current;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const footerEl = footerRef.current;
    if (!body || !footerEl) return;
    let lastNonSheetPanelsHeight = 0;
    const sync = () => {
      const height = Math.round(footerEl.getBoundingClientRect().height);
      const panelsEl = footerEl.querySelector<HTMLElement>('.v2-composer-panels');
      const panelsHeight = panelsEl ? Math.round(panelsEl.getBoundingClientRect().height) : 0;
      const hasSheet = footerEl.querySelector('.dvx-subagent-sheet') !== null;
      let contentInset: number;
      if (hasSheet) {
        contentInset = Math.max(0, height - panelsHeight) + lastNonSheetPanelsHeight;
      } else {
        lastNonSheetPanelsHeight = panelsHeight;
        contentInset = height;
      }
      body.style.setProperty('--chat-footer-height', `${height}px`);
      body.style.setProperty('--chat-content-inset', `${contentInset}px`);
      const clip = height >= 44 ? 30 : 0;
      if (clip > 0) {
        body.style.setProperty('--chat-footer-clip', `${clip}px`);
        body.setAttribute('data-footer-clip', 'true');
      } else {
        body.style.removeProperty('--chat-footer-clip');
        body.removeAttribute('data-footer-clip');
      }
      footerInset.setHeight(contentInset);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(footerEl);
    return () => {
      observer.disconnect();
      body.style.removeProperty('--chat-footer-height');
      body.style.removeProperty('--chat-content-inset');
      body.style.removeProperty('--chat-footer-clip');
      body.removeAttribute('data-footer-clip');
    };
  }, [footerInset]);
  return <NavigationHost.Provider value={navigationHost}><main {...props} className={`v2-chat-surface relative isolate grid h-full min-w-0 flex-1 grid-rows-[40px_minmax(0,1fr)_auto] ${props.className ?? ''}`}>
    {starfield === 'three-body' ? <ThreeBodyBackdrop /> : starfield === true || starfield === 'starfield' ? <StarfieldBackdrop /> : null}
    <header className="relative z-[1] col-start-1 row-start-1 flex min-w-0 select-none items-center justify-between gap-2 px-3 py-1">{header}</header>
    <div ref={bodyRef} className="relative col-start-1 row-start-2 row-end-4 grid min-h-0 min-w-0">
      <FooterInsetContext.Provider value={footerInset.store}>
        {children}
      </FooterInsetContext.Provider>
    </div>
    {overlay ? <div className="pointer-events-none relative z-20 col-start-1 row-start-2 grid min-h-0 min-w-0">{overlay}</div> : null}
    <footer ref={footerRef} className="v2-chat-footer pointer-events-none relative z-10 col-start-1 row-start-3 space-y-2">{footer}</footer>
    <div ref={setNavigationHost} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
  </main></NavigationHost.Provider>;
}
