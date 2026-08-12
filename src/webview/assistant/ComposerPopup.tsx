import { useEffect, useRef } from 'react';

/**
 * Shared shell for the composer's `@` mention and `/` command popups.
 *
 * Owns the two behaviors both cards need:
 * - wheel containment: scrolling the card never chains into the
 *   transcript, including at the top/bottom boundary (the CSS
 *   `overscroll-behavior: contain` companion covers momentum flings);
 * - light dismissal: any pointer press outside the card and Escape
 *   pressed anywhere close the popup.
 */
export function ComposerPopup({
  className,
  label,
  onDismiss,
  popupRef,
  children,
}: {
  readonly className: string;
  readonly label: string;
  readonly onDismiss: () => void;
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
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (popupRef !== undefined) {
          popupRef.current = element;
        }
      }}
      className={className}
      role="listbox"
      aria-label={label}
    >
      {children}
    </div>
  );
}
