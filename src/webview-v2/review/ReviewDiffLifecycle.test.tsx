// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';
import { ReviewApp } from './ReviewApp';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
});

const scope: ReviewScopeState = {
  sessionId: 's1', reviewScopeId: 'scope1', scopeKind: 'operations', baseline: 'operations-t1', turnId: 't1',
  baselineLabel: 'Recorded edits from this turn', lifecycle: 'writing', currentIndex: 0, reviewedCount: 0, reviewableCount: 1,
  files: [{ path: 'app.ts', additions: null, deletions: null, status: 'unreviewed', version: 'v1', restorable: false }],
};
const entries: ReviewRecordedEntry[] = [
  { toolUseId: 'first', source: 'tool-result', outcome: 'applied', patch: '@@ -2 +2 @@\n-before\n+middle' },
  { toolUseId: 'second', source: 'tool-result', outcome: 'applied', patch: '@@ -2 +2 @@\n-middle\n+after' },
];
const fullPatch = '@@ -1,3 +1,3 @@\n unchanged start\n-before\n+middle\n unchanged end';
function send(data: unknown) { act(() => window.dispatchEvent(new MessageEvent('message', { data }))); }
function setup() {
  const port = { postMessage: vi.fn() };
  render(<ReviewApp port={port} />);
  send({ type: 'reviewPanel.context', sessionId: 's1', valid: true, latestTurnId: 't1', operation: null, operationPath: null });
  send({ type: 'review.state', sequence: 1, state: scope });
  const request = () => port.postMessage.mock.calls.filter(([entry]) => entry.type === 'reviewPanel.readFile').at(-1)![0];
  const reply = (recordedOperations: ReviewRecordedEntry[], requestId = request().requestId) => send({
    type: 'reviewPanel.file', requestId, reviewScopeId: 'scope1', path: 'app.ts', version: 'v1',
    patch: '', truncated: false, error: null, recordedOperations,
  });
  return { port, request, reply };
}

it('requests the selected edit on demand, preserves selection across context changes and opens that native diff', async () => {
  const user = userEvent.setup();
  const { port, request, reply } = setup();
  reply(entries);
  expect(screen.getByText('Edit 2 of 2')).toBeDefined();
  expect(screen.getByText(/Full file comparison unavailable/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Previous recorded edit' }));
  expect(request()).toMatchObject({ toolUseId: 'first', context: 'all' });
  expect(screen.getByText('Loading full file comparison…')).toBeDefined();
  reply([{ ...entries[0]!, fullPatch }, entries[1]!]);
  expect(screen.getByText('Edit 1 of 2')).toBeDefined();
  expect(screen.getByText('unchanged start')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'More file actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Saved change excerpts' }));
  expect(request()).toMatchObject({ toolUseId: 'first', context: 3 });
  reply([{ ...entries[0]!, fullPatch }, entries[1]!]);
  expect(screen.getByText('Edit 1 of 2')).toBeDefined();
  expect(screen.queryByText('unchanged start')).toBeNull();
  expect(screen.getByText('middle')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'More file actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Open Native Diff' }));
  expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'reviewPanel.openNative', toolUseId: 'first' }));
});

it('keeps a live comparison visible during successive reads and discards it when the turn settles', () => {
  const { request, reply } = setup();
  const first = request();
  send({ type: 'review.state', sequence: 2, state: { ...scope, files: [{ ...scope.files[0]!, version: 'v2' }] } });
  reply(entries, first.requestId);
  expect(screen.getByText('after')).toBeDefined();
  expect(screen.getByText(/Live run/)).toBeDefined();
  send({ type: 'review.state', sequence: 3, state: { ...scope, lifecycle: 'settled', files: [{ ...scope.files[0]!, version: 'v3' }] } });
  expect(request().requestId).not.toBe(first.requestId);
  expect(screen.getByText(/Recorded operations · inspect each edit/)).toBeDefined();
  reply([{ ...entries[1]!, fullPatch: '@@ -1 +1 @@\n-middle\n+settled' }]);
  expect(screen.getByText('settled')).toBeDefined();
  reply(entries, first.requestId);
  expect(screen.getByText('settled')).toBeDefined();
  expect(screen.queryByText('after')).toBeNull();
});

it('loads full context for a tool card target and switches to another tool in the same session', () => {
  const { request, reply } = setup();
  send({ type: 'reviewPanel.context', sessionId: 's1', valid: true, latestTurnId: 't1',
    operation: null, operationPath: 'app.ts', toolUseId: 'first' });
  expect(request()).toMatchObject({ toolUseId: 'first', context: 'all' });
  reply([{ ...entries[0]!, fullPatch }, entries[1]!]);
  expect(screen.getByText('Edit 1 of 2')).toBeDefined();
  send({ type: 'reviewPanel.context', sessionId: 's1', valid: true, latestTurnId: 't1',
    operation: null, operationPath: 'app.ts', toolUseId: 'second' });
  expect(request()).toMatchObject({ toolUseId: 'second', context: 'all' });
  reply(entries);
  expect(screen.getByText('Edit 2 of 2')).toBeDefined();
  expect(screen.queryByText('unchanged start')).toBeNull();
});

it('explains preview limits without claiming the full versions are missing', () => {
  const { port, reply } = setup();
  reply([{ ...entries[1]!, fullPatchUnavailableReason: 'too-large' }]);
  expect(screen.getByText('Full comparison exceeds the preview limit. Open Native Diff to read the complete file.')).toBeDefined();
  expect(screen.queryByText(/Full file comparison unavailable/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Native Diff' }));
  expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'reviewPanel.openNative', path: 'app.ts' }));
});

it('does not offer an unusable native comparison when complete versions are unavailable', async () => {
  const user = userEvent.setup();
  const { reply } = setup();
  reply([{ ...entries[1]!, fullPatchUnavailableReason: 'unavailable' }]);
  expect(screen.getByText(/Full file comparison unavailable/)).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Open Native Diff' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'More file actions' }));
  expect(screen.getByRole('menuitem', { name: 'Open Native Diff' }).getAttribute('aria-disabled')).toBe('true');
});

it('rejects a live response arriving in the same React batch as settlement', () => {
  const { request, reply } = setup();
  const liveRequest = request();
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'review.state', sequence: 2, state: { ...scope, lifecycle: 'settled' },
    } }));
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'reviewPanel.file', requestId: liveRequest.requestId, reviewScopeId: 'scope1', path: 'app.ts', version: 'v1',
      patch: '', truncated: false, error: null, recordedOperations: [{ ...entries[1]!, patch: '@@ -1 +1 @@\n-before\n+obsolete live' }],
    } }));
  });
  expect(screen.queryByText('obsolete live')).toBeNull();
  expect(request().requestId).not.toBe(liveRequest.requestId);
  reply([{ ...entries[1]!, patch: '@@ -1 +1 @@\n-before\n+completed result' }]);
  expect(screen.getByText('completed result')).toBeDefined();
});
