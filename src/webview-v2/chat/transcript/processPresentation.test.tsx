// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ProcessPresentationProvider, useProcessDisclosure } from './processPresentation';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('process disclosure behavior', () => {
  it('returns keyboard focus to the summary and removes collapsed content from interaction', () => {
    function Disclosure() {
      const { expanded, mounted, toggle, buttonRef, contentRef } = useProcessDisclosure(
        'message-1',
        0,
      );
      return (
        <>
          <button ref={buttonRef} onClick={toggle} aria-expanded={expanded}>
            Activity
          </button>
          <div
            ref={contentRef}
            inert={expanded ? undefined : true}
            aria-hidden={!expanded}
          >
            {mounted ? <button>Inside detail</button> : null}
          </div>
        </>
      );
    }
    const following = createRef<{ following: boolean }>();
    render(
      <ProcessPresentationProvider messageIds={['message-1']} followingRef={following}>
        <Disclosure />
      </ProcessPresentationProvider>,
    );
    const summary = screen.getByRole('button', { name: 'Activity' });
    fireEvent.click(summary);
    screen.getByRole('button', { name: 'Inside detail' }).focus();
    fireEvent.click(summary, { detail: 0 });
    expect(document.activeElement).toBe(summary);
    expect(screen.queryByRole('button', { name: 'Inside detail' })).toBeNull();
  });
});
