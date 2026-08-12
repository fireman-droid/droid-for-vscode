// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerPopup } from './ComposerPopup';

afterEach(cleanup);

function renderPopup(onDismiss: () => void): HTMLElement {
  render(
    <div>
      <button type="button">outside</button>
      <ComposerPopup
        className="dvx-mention-popup"
        label="Attach workspace file"
        onDismiss={onDismiss}
      >
        <button type="button" role="option" aria-selected>
          inside
        </button>
      </ComposerPopup>
    </div>,
  );
  return screen.getByRole('listbox', { name: 'Attach workspace file' });
}

/** Sizes the popup's scroll metrics (jsdom performs no layout). */
function sizeScroll(
  element: HTMLElement,
  metrics: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
): void {
  Object.defineProperty(element, 'scrollHeight', {
    value: metrics.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(element, 'clientHeight', {
    value: metrics.clientHeight,
    configurable: true,
  });
  Object.defineProperty(element, 'scrollTop', {
    value: metrics.scrollTop,
    writable: true,
    configurable: true,
  });
}

function dispatchWheel(element: HTMLElement, deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event;
}

describe('ComposerPopup', () => {
  it('dismisses on a pointer press outside the card', () => {
    const onDismiss = vi.fn();
    renderPopup(onDismiss);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays open on a pointer press inside the card', () => {
    const onDismiss = vi.fn();
    renderPopup(onDismiss);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'inside' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on Escape pressed anywhere in the document', () => {
    const onDismiss = vi.fn();
    renderPopup(onDismiss);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('swallows wheel deltas the list cannot consume at its boundary', () => {
    const popup = renderPopup(vi.fn());
    sizeScroll(popup, { scrollHeight: 400, clientHeight: 200, scrollTop: 0 });
    // At the top, scrolling up must not chain to the transcript.
    expect(dispatchWheel(popup, -40).defaultPrevented).toBe(true);
    // Scrolling down can be consumed by the list, so it stays native.
    expect(dispatchWheel(popup, 40).defaultPrevented).toBe(false);
    sizeScroll(popup, {
      scrollHeight: 400,
      clientHeight: 200,
      scrollTop: 200,
    });
    // At the bottom the downward delta would leak; swallow it too.
    expect(dispatchWheel(popup, 40).defaultPrevented).toBe(true);
    expect(dispatchWheel(popup, -40).defaultPrevented).toBe(false);
  });

  it('swallows all wheel deltas when the list has nothing to scroll', () => {
    const popup = renderPopup(vi.fn());
    sizeScroll(popup, { scrollHeight: 120, clientHeight: 200, scrollTop: 0 });
    expect(dispatchWheel(popup, 40).defaultPrevented).toBe(true);
    expect(dispatchWheel(popup, -40).defaultPrevented).toBe(true);
  });
});
