// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import { InlineDiffContext } from './useInlineDiff';
import { ExplorationToolRow } from '../transcript/activity/ExplorationToolRow';
import { ProcessPresentationProvider } from '../transcript/processPresentation';
import type { ToolActivityPresentation } from '../thread/readers';

const state = vi.hoisted(() => ({ message: { id: 'message-1' } }));
vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  useAuiState: (selector: (value: typeof state) => unknown) => selector(state),
}));
const postMessage = vi.fn((_message: WebviewToHostMessage) => undefined);
const context = { port: { postMessage, getState: vi.fn(), setState: vi.fn() }, sessionId: 'session-1', connected: true };
const activity: ToolActivityPresentation = {
  turnId: 'turn-1', action: 'Edited', status: 'completed',
  progressCount: 0, latestUpdateKind: null, durationMs: null,
  filePath: 'app.ts', detailKind: null, detail: null, target: 'app.ts',
  errorMessage: null, outputTail: null, background: false, subagent: null,
};
function View({ value = context, item = activity, toolName = 'Edit' }: {
  value?: typeof context; item?: ToolActivityPresentation; toolName?: string;
}) {
  return (
    <InlineDiffContext.Provider value={value}>
      <ProcessPresentationProvider messageIds={['message-1']} followingRef={{ current: { following: true } }}>
        <ExplorationToolRow activity={item} toolName={toolName} toolUseId="tool-1" />
      </ProcessPresentationProvider>
    </InlineDiffContext.Provider>
  );
}
function request(index = postMessage.mock.calls.length - 1) {
  const message = postMessage.mock.calls[index]![0];
  if (message.type !== 'file.readDiff') throw new Error('Expected a diff request');
  return message;
}
function reply(message = request(), result: unknown = {
  status: 'ready', phase: 'settled', patch: '@@ -1 +1 @@\n-old code\n+new code', truncated: false,
}) {
  act(() => window.dispatchEvent(new MessageEvent('message', {
    data: { ...message, type: 'file.diff', sequence: 1, result },
  })));
}
beforeEach(() => {
  postMessage.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('editing record inline diff', () => {
  it('loads only after expanding, displays actual lines, opens that turn in the editor and stops listening on collapse', () => {
    render(<View />);
    const toggle = screen.getByRole('button', { name: /^Edited/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(request()).toMatchObject({ sessionId: 'session-1', turnId: 'turn-1', path: 'app.ts' });
    reply();
    expect(screen.getByText('old code')).toBeTruthy();
    expect(screen.getByText('new code')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open diff in editor' }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'file.openTurnDiff', sessionId: 'session-1', turnId: 'turn-1', path: 'app.ts' });
    fireEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Diff for app.ts' })).toBeNull();
  });

  it('isolates old session responses and refreshes on settlement even when counts stay the same', async () => {
    const view = render(<View />);
    fireEvent.click(screen.getByRole('button', { name: /^Edited/ }));
    const stale = request();
    view.rerender(<View value={{ ...context, sessionId: 'session-2' }} />);
    const current = request();
    reply(stale);
    expect(screen.queryByText('old code')).toBeNull();
    reply(current, { status: 'ready', phase: 'live', patch: '@@ -1 +1 @@\n-old code\n+live code', truncated: false });
    expect(screen.getByText('live code')).toBeTruthy();
    act(() => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'changes.update', sequence: 2, sessionId: 'session-2', turnId: 'turn-1',
        state: 'settled', files: [{ path: 'app.ts', additions: 1, deletions: 1 }] },
    })));
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
    expect(request().requestId).not.toBe(current.requestId);
    reply(current);
    expect(screen.queryByText('new code')).toBeNull();
    reply();
    expect(screen.getByText('new code')).toBeTruthy();
    expect(screen.getByText('This turn · before → after')).toBeTruthy();
  });

  it('refreshes after another edit to the file even without a changes.update event', async () => {
    render(<View />);
    fireEvent.click(screen.getByRole('button', { name: /^Edited/ }));
    reply();
    act(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'tool.activity', sequence: 2, sessionId: 'session-1', turnId: 'turn-1',
      toolUseId: 'tool-2', toolName: 'Edit', action: 'Edited', status: 'completed',
      progressCount: 0, latestUpdateKind: null, filePath: 'app.ts',
    } })));
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    reply(request(), { status: 'ready', phase: 'live', patch: '@@ -1 +1 @@\n-old code\n+second edit', truncated: false });
    expect(screen.getByText('second edit')).toBeTruthy();
    expect(screen.queryByText('new code')).toBeNull();
  });

  it('offers retry for unavailable content without offering a misleading editor comparison', () => {
    render(<View />);
    fireEvent.click(screen.getByRole('button', { name: /^Edited/ }));
    reply(request(), { status: 'unavailable' });
    expect(screen.getByText('The snapshots for this turn are unavailable.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open diff in editor' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(postMessage).toHaveBeenCalledTimes(2);
    reply(request(), { status: 'ready', phase: 'settled', patch: '', truncated: true });
    expect(screen.queryByText('No net text changes in this turn.')).toBeNull();
    expect(screen.getByText(/Preview truncated/)).toBeTruthy();
  });

  it('does not request file diffs for running edits or read-only tools', () => {
    const view = render(<View item={{ ...activity, status: 'running' }} />);
    expect(screen.queryByRole('button', { name: /^Edited/ })).toBeNull();
    view.rerender(<View toolName="Read" item={{ ...activity, action: 'Read' }} />);
    expect(postMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Diff for app.ts' })).toBeNull();
  });
});
