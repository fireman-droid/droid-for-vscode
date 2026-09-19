import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
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
  readonly choices: Map<string, Map<number | string, boolean>>;
  readonly automaticChoices: Map<string, Map<number | string, boolean>>;
  readonly selections: Map<string, Map<number | string, string | null>>;
  readonly pauseFollowing: () => void;
  readonly followingRef: RefObject<{ following: boolean } | null>;
}
const ProcessPresentationContext = createContext<ProcessPresentation | null>(null);
export const ProcessGroupContext = createContext(false);

export function ProcessPresentationProvider({
  messageIds,
  followingRef,
  children,
}: {
  readonly messageIds: readonly string[];
  readonly followingRef: RefObject<{ following: boolean } | null>;
  readonly children: ReactNode;
}): React.JSX.Element {
  const choices = useRef(new Map<string, Map<number | string, boolean>>());
  const automaticChoices = useRef(new Map<string, Map<number | string, boolean>>());
  const selections = useRef(new Map<string, Map<number | string, string | null>>());
  useEffect(() => {
    const current = new Set(messageIds);
    for (const messageId of choices.current.keys()) {
      if (!current.has(messageId)) choices.current.delete(messageId);
    }
    for (const messageId of automaticChoices.current.keys()) {
      if (!current.has(messageId)) automaticChoices.current.delete(messageId);
    }
    for (const messageId of selections.current.keys()) {
      if (!current.has(messageId)) selections.current.delete(messageId);
    }
  }, [messageIds]);
  const value = useMemo<ProcessPresentation>(
    () => ({
      choices: choices.current,
      automaticChoices: automaticChoices.current,
      selections: selections.current,
      followingRef,
      pauseFollowing: () => {
        if (followingRef.current !== null) followingRef.current.following = false;
      },
    }),
    [followingRef],
  );
  return (
    <ProcessPresentationContext.Provider value={value}>
      {children}
    </ProcessPresentationContext.Provider>
  );
}

export function useProcessDisclosure(
  messageId: string,
  start: number | string | undefined,
  automaticExpanded = false,
  preserveExpanded = false,
) {
  const presentation = useContext(ProcessPresentationContext);
  const reducedMotion = useReducedMotion();
  const [override, setOverride] = useState<boolean | null>(
    () =>
      start === undefined ? null : presentation?.choices.get(messageId)?.get(start) ?? null,
  );
  const automatic = useRef(start === undefined ? automaticExpanded :
    presentation?.automaticChoices.get(messageId)?.get(start) ?? automaticExpanded);
  // Interrupted activity retains its layout when a new turn restores follow,
  // including after the virtualizer unmounts and remounts the old row.
  if (automaticExpanded || (!preserveExpanded && presentation?.followingRef.current?.following !== false))
    automatic.current = automaticExpanded;
  const automaticValue = automatic.current;
  useLayoutEffect(() => {
    if (!presentation || start === undefined) return;
    const saved = presentation.automaticChoices.get(messageId) ?? new Map<number | string, boolean>();
    saved.set(start, automaticValue);
    presentation.automaticChoices.set(messageId, saved);
  }, [presentation, messageId, start, automaticValue]);
  const expanded = override ?? automatic.current;
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
    setMounted(true);
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

  const toggle = (event?: { readonly detail: number }): void => {
    presentation?.pauseFollowing();
    if (
      expanded &&
      event?.detail === 0 &&
      contentRef.current?.contains(document.activeElement)
    ) {
      buttonRef.current?.focus({ preventScroll: true });
    }
    const next = !expanded;
    const choices = presentation?.choices;
    if (choices !== undefined && start !== undefined) {
      const selected = choices.get(messageId) ?? new Map<number | string, boolean>();
      selected.set(start, next);
      choices.set(messageId, selected);
    }
    if (next) setMounted(true);
    else setVisible(false);
    setOverride(next);
  };
  return { expanded, mounted, visible, toggle, buttonRef, contentRef };
}

export function useProcessSelection(
  messageId: string,
  groupId: number | string,
  automaticSelection: string | null,
) {
  const presentation = useContext(ProcessPresentationContext);
  const [override, setOverride] = useState<string | null | undefined>(
    () => presentation?.selections.get(messageId)?.get(groupId),
  );
  const selected = override === undefined ? automaticSelection : override;
  const select = (id: string): void => {
    presentation?.pauseFollowing();
    const next = selected === id ? null : id;
    const selections = presentation?.selections;
    if (selections !== undefined) {
      const group = selections.get(messageId) ?? new Map<number | string, string | null>();
      group.set(groupId, next);
      selections.set(messageId, group);
    }
    setOverride(next);
  };
  return { selected, select };
}
