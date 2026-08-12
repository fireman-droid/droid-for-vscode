import { useEffect, useRef } from 'react';

/**
 * Shared shell for the composer's `@` mention and `/` command popups.
 *
 * Owns the two behaviors both cards need:
 * - wheel containment: scrolling the card never chains into the
 *   transcript, including at the top/bottom boundary (the CSS
 *   `overscroll-behavior: contain` companion covers momentum flings);
 * - light dismissal: any pointer press outside the card and Escape
 *   pressed anywhere close the popup. Persistent cards (the `/btw`
 *   side chat) opt out of the outside-press part and keep Escape;
 * - highlight follow: keyboard navigation moves an `aria-selected`
 *   mark between option rows, and the card scrolls to keep the
 *   marked row visible.
 */
export function ComposerPopup({
  className,
  label,
  role = 'listbox',
  onDismiss,
  dismissOnOutsidePress = true,
  popupRef,
  children,
}: {
  readonly className: string;
  readonly label: string;
  /** Default 'listbox' (option pickers); the side chat uses 'dialog'. */
  readonly role?: 'listbox' | 'dialog';
  readonly onDismiss: () => void;
  /** Default true; false keeps the card open across outside presses. */
  readonly dismissOnOutsidePress?: boolean;
  /** Optional external handle to the card (tooltip anchoring). */
  readonly popupRef?: React.MutableRefObject<HTMLDivElement | null>;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Listeners attach once; the latest dismiss closure is read through
  // a ref so re-renders never tear down document-level handlers.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }
    // React delegates wheel events passively, so boundary containment
    // needs a native non-passive listener to be able to preventDefault.
    const onWheel = (event: WheelEvent): void => {
      const scrollable = element.scrollHeight > element.clientHeight;
      const atTop = element.scrollTop <= 0;
      const atBottom =
        element.scrollTop + element.clientHeight >=
        element.scrollHeight - 1;
      const consumes =
        scrollable &&
        (event.deltaY < 0 ? !atTop : event.deltaY > 0 && !atBottom);
      if (!consumes) {
        event.preventDefault();
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }
    // Keep the keyboard-highlighted row visible: whenever the
    // aria-selected mark moves (arrow keys, wrap-around jumps) or the
    // filtered list re-renders under it, scroll the marked row into
    // view. Observing the DOM keeps this in one place for every list
    // popup instead of threading each caller's highlight index here;
    // 'nearest' never scrolls when the row is already fully visible.
    const followHighlight = (): void => {
      element
        .querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    };
    followHighlight();
    const observer = new MutationObserver(followHighlight);
    observer.observe(element, {
      subtree: true,
      childList: true,
      attributeFilter: ['aria-selected'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        ref.current?.contains(event.target) === true
      ) {
        return;
      }
      dismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismissRef.current();
      }
    };
    if (dismissOnOutsidePress) {
      document.addEventListener('pointerdown', onPointerDown, true);
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      if (dismissOnOutsidePress) {
        document.removeEventListener('pointerdown', onPointerDown, true);
      }
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [dismissOnOutsidePress]);

  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (popupRef !== undefined) {
          popupRef.current = element;
        }
      }}
      className={className}
      role={role}
      aria-label={label}
    >
      {children}
    </div>
  );
}
