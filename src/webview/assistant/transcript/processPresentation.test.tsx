// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ProcessPresentationProvider, useProcessDisclosure } from './processPresentation';
import { ExplorationToolRow } from './activity/ExplorationToolRow';
import { OpenPathContext } from '../markdown/MarkdownText';
import type { ToolActivityPresentation } from '../thread/readers';

const state = vi.hoisted(() => ({ message: { id: 'message-1' } }));
vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  useAuiState: (selector: (value: typeof state) => unknown) => selector(state),
}));

const originalText = 'const historicalValue = 42;';
const activity: ToolActivityPresentation = {
  turnId: 'turn-1',
  action: 'Read workspace files',
  status: 'completed',
  progressCount: 0,
  latestUpdateKind: null,
  durationMs: null,
  filePath: null,
  detailKind: null,
  detail: null,
  target: 'app.ts',
  errorMessage: null,
  outputTail: null,
  background: false,
  subagent: null,
};
const withResult: ToolActivityPresentation = {
  ...activity,
  resultPreview: {
    availability: 'available',
    source: { tool: 'Read', path: 'app.ts', callId: 'call-1' },
    text: originalText,
    truncated: false,
  },
};
const followingRef = { current: { following: true } };
const openPath = vi.fn();
function View({
  shown = true,
  item = withResult,
}: {
  shown?: boolean;
  item?: ToolActivityPresentation;
}) {
  return (
    <OpenPathContext.Provider value={openPath}>
      <ProcessPresentationProvider messageIds={['message-1']} followingRef={followingRef}>
        {shown ? (
          <ExplorationToolRow activity={item} toolName="Read" toolUseId="call-1" />
        ) : null}
      </ProcessPresentationProvider>
    </OpenPathContext.Provider>
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  followingRef.current.following = true;
  openPath.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('process disclosure behavior', () => {
  it('does not offer an empty expansion, mounts snippets only on demand, and opens the current file separately', () => {
    const view = render(<View item={activity} />);
    expect(screen.queryByRole('button', { name: /^Read/ })).toBeNull();
    view.rerender(<View />);
    expect(screen.queryByText(originalText)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Read/ }));
    expect(screen.getByText(originalText)).toBeTruthy();
    expect(followingRef.current.following).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open current file' }));
    expect(openPath).toHaveBeenCalledWith({ path: 'app.ts' });
    expect(screen.getByText(originalText)).toBeTruthy();
  });

  it('retains a tool expansion across virtual unmount, completion and result updates in the same Thread', () => {
    const view = render(<View item={{ ...withResult, status: 'running' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Read/ }));
    view.rerender(<View shown={false} />);
    expect(screen.queryByText(originalText)).toBeNull();
    view.rerender(<View />);
    expect(
      screen.getByRole('button', { name: /^Read/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText(originalText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Read/ }));
    expect(screen.queryByText(originalText)).toBeNull();
  });

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
