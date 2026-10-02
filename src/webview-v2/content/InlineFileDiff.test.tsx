// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WebviewToHostMessage } from '../../shared/bridgeMessages';
import { InlineDiffContext } from '../review/useInlineDiff';
import { InlineFileDiff } from './InlineFileDiff';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const postMessage = vi.fn((_message: WebviewToHostMessage) => undefined);
const context = { port: { postMessage }, sessionId: 'session-1', connected: true };
function View({ value = context, expanded = true }: { value?: typeof context; expanded?: boolean }) {
  return <InlineDiffContext.Provider value={value}><InlineFileDiff path="app.ts" turnId="turn-1" expanded={expanded} /></InlineDiffContext.Provider>;
}
function request() {
  const message = postMessage.mock.calls.at(-1)![0];
  if (message.type !== 'file.readDiff') throw new Error('Expected a diff request');
  return message;
}
function reply(message = request(), result: unknown = { status: 'ready', phase: 'settled', patch: '@@ -1 +1 @@\n-old code\n+new code', truncated: false }) {
  act(() => window.dispatchEvent(new MessageEvent('message', { data: { ...message, type: 'file.diff', sequence: 1, result } })));
}

it('loads only on expansion and opens the exact turn diff only when snapshots are available', () => {
  const view = render(<View expanded={false} />);
  expect(postMessage).not.toHaveBeenCalled();
  view.rerender(<View />);
  expect(request()).toMatchObject({ sessionId: 'session-1', turnId: 'turn-1', path: 'app.ts' });
  reply(request(), { status: 'unavailable' });
  expect(screen.getByText('The snapshots for this turn are unavailable.')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Open diff in editor' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  reply();
  expect(screen.getByText('old code')).toBeDefined();
  expect(screen.getByText((_text, element) => element?.tagName === 'CODE' && element.textContent === 'new code')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Open diff in editor' }));
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'file.openTurnDiff', sessionId: 'session-1', turnId: 'turn-1', path: 'app.ts' });
});

it('ignores stale session responses and replaces the live preview on settlement', async () => {
  const view = render(<View />);
  const stale = request();
  view.rerender(<View value={{ ...context, sessionId: 'session-2' }} />);
  const current = request();
  reply(stale);
  expect(screen.queryByText('old code')).toBeNull();
  reply(current, { status: 'ready', phase: 'live', patch: '@@ -1 +1 @@\n-old code\n+live code', truncated: false });
  expect(screen.getByText('Live workspace · before turn → current')).toBeDefined();
  act(() => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'changes.update', sequence: 2, sessionId: 'session-2', turnId: 'turn-1', state: 'settled', files: [{ path: 'app.ts', additions: 1, deletions: 1 }],
  } })));
  await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
  reply(current);
  expect(screen.queryByText((_text, element) => element?.tagName === 'CODE' && element.textContent === 'new code')).toBeNull();
  reply(request(), { status: 'ready', phase: 'settled', patch: '', truncated: true });
  expect(screen.queryByText('No net workspace text changes in this turn.')).toBeNull();
  expect(screen.getByText(/Preview truncated/)).toBeDefined();
});
