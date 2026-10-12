import { Component, type ReactNode, type RefObject } from 'react';

interface Snapshot { bottom: number; scroller: HTMLElement }

function scrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
    parent = parent.parentElement;
  }
  return null;
}

/** Measure before React inserts a reply so the active composer stays at its screen position. */
export class KeepComposerPosition extends Component<{
  anchor: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}, Record<string, never>, Snapshot | null> {
  getSnapshotBeforeUpdate(): Snapshot | null {
    const anchor = this.props.anchor.current;
    const scroller = anchor && scrollParent(anchor);
    if (!anchor || !scroller) return null;
    const rectangle = anchor.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    if (rectangle.bottom <= viewport.top || rectangle.top >= viewport.bottom) return null;
    return { bottom: rectangle.bottom, scroller };
  }

  componentDidUpdate(_props: unknown, _state: unknown, snapshot: Snapshot | null): void {
    const anchor = this.props.anchor.current;
    if (anchor && snapshot) snapshot.scroller.scrollTop += anchor.getBoundingClientRect().bottom - snapshot.bottom;
  }

  render(): ReactNode { return this.props.children; }
}
