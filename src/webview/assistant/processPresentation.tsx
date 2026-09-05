import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode, type RefObject,
} from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (notify: () => void): (() => void) => {
  const media = window.matchMedia?.(REDUCED_MOTION);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
};
const readMotion = (): boolean => window.matchMedia?.(REDUCED_MOTION).matches ?? false;
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, readMotion, () => false);
}

interface ProcessPresentation {
  readonly choices: Map<string, Set<number>>;
  readonly pauseFollowing: () => void;
}
const ProcessPresentationContext = createContext<ProcessPresentation | null>(null);
export const ProcessGroupContext = createContext(false);

export function ProcessPresentationProvider({
  messageIds, followingRef, children,
}: {
  readonly messageIds: readonly string[];
  readonly followingRef: RefObject<{ following: boolean } | null>;
  readonly children: ReactNode;
}): React.JSX.Element {
  const choices = useRef(new Map<string, Set<number>>());
  useEffect(() => {
    const current = new Set(messageIds);
    for (const messageId of choices.current.keys()) {
      if (!current.has(messageId)) choices.current.delete(messageId);
    }
  }, [messageIds]);
  const value = useMemo<ProcessPresentation>(() => ({
    choices: choices.current,
    pauseFollowing: () => {
      if (followingRef.current !== null) followingRef.current.following = false;
    },
  }), [followingRef]);
  return (
    <ProcessPresentationContext.Provider value={value}>
      {children}
    </ProcessPresentationContext.Provider>
  );
}

export function useProcessDisclosure(messageId: string, start: number) {
  const presentation = useContext(ProcessPresentationContext);
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(
    () => presentation?.choices.get(messageId)?.has(start) ?? false,
  );
  const [mounted, setMounted] = useState(expanded);
  const [visible, setVisible] = useState(expanded);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) {
      setVisible(false);
      if (reducedMotion) {
        setMounted(false);
        return undefined;
      }
      const timer = window.setTimeout(() => setMounted(false), 220);
      return () => window.clearTimeout(timer);
    }
    if (reducedMotion) {
      setVisible(true);
      return undefined;
    }
    // Newly mounted details need a collapsed layout before their first transition.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setVisible(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, reducedMotion]);

  const toggle = (): void => {
    presentation?.pauseFollowing();
    if (expanded && contentRef.current?.contains(document.activeElement)) {
      buttonRef.current?.focus({ preventScroll: true });
    }
    const next = !expanded;
    const choices = presentation?.choices;
    if (choices !== undefined) {
      const selected = choices.get(messageId) ?? new Set<number>();
      if (next) selected.add(start);
      else selected.delete(start);
      if (selected.size === 0) choices.delete(messageId);
      else choices.set(messageId, selected);
    }
    if (next) setMounted(true);
    else setVisible(false);
    setExpanded(next);
  };
  return { expanded, mounted, visible, toggle, buttonRef, contentRef };
}
