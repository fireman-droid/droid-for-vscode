// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import type { WebviewToHostMessage } from '../../shared/bridgeMessages';
import { ProcessPresentationProvider } from '../../webview/assistant/transcript/processPresentation';
import { InlineDiffContext } from '../../webview/assistant/changes/useInlineDiff';
import { SubagentActivityStoreContext, useSubagentPanelFlow } from '../../webview/assistant/subagents/subagentPanelFlow';
import { ContentProvider } from '../content/context';
import { ToolActionsContext, type ToolActions } from '../content/toolActions';
import { ToolRow } from './ToolRow';
import { TranscriptRow } from './TranscriptRow';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const postMessage = vi.fn((_message: WebviewToHostMessage) => undefined);
const diff = { port: { postMessage }, sessionId: 'session-1', connected: true };
const following = { current: { following: true } };
const base: ToolTranscriptItem = { kind: 'tool', id: 'tool-row', turnId: 'turn-1', toolUseId: 'tool-1', toolName: 'Execute', action: 'Run checks', status: 'running', progressCount: 0, latestUpdateKind: null, detailKind: 'command', detail: 'pnpm run test', outputTail: 'Running checks…' };
function View({ item = base, shown = true, actions = {} }: { item?: ToolTranscriptItem; shown?: boolean; actions?: ToolActions }) {
  return <ToolActionsContext.Provider value={actions}><InlineDiffContext.Provider value={diff}>
    <ProcessPresentationProvider messageIds={['message-1']} followingRef={following}>
      {shown ? <ToolRow item={item} messageId="message-1" /> : null}
    </ProcessPresentationProvider>
  </InlineDiffContext.Provider></ToolActionsContext.Provider>;
}

it('automatically settles command disclosure while preserving explicit reader choices across eviction', () => {
  const view = render(<View />);
  expect(screen.getByRole('button', { name: /Run checks/ }).getAttribute('aria-expanded')).toBe('true');
  view.rerender(<View item={{ ...base, status: 'completed' }} />);
  expect(screen.getByRole('button', { name: /Run checks/ }).getAttribute('aria-expanded')).toBe('false');
  view.rerender(<View />);
  fireEvent.click(screen.getByRole('button', { name: /Run checks/ }));
  view.rerender(<View shown={false} />);
  view.rerender(<View />);
  expect(screen.getByRole('button', { name: /Run checks/ }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: /Run checks/ }));
  view.rerender(<View item={{ ...base, status: 'failed', errorMessage: 'Command failed\nAdditional failure detail' }} />);
  expect(screen.getByRole('button', { name: /Run checks/ }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByLabelText('Command and output').textContent).toContain('Running checks…\nCommand failed');
  expect(screen.getByLabelText('Command and output').textContent).not.toContain('Additional failure detail');
  expect(following.current.following).toBe(false);
});

it('separates unavailable snippets from failure and opens current files without fetching a diff', () => {
  const openPath = vi.fn();
  const read: ToolTranscriptItem = { kind: 'tool', id: 'read-row', turnId: 'turn-1', toolUseId: 'read-1', toolName: 'Read', action: 'Read file', status: 'completed', progressCount: 0, latestUpdateKind: null, target: 'src/app.ts' };
  const view = render(<View item={read} actions={{ openPath }} />);
  expect(screen.getByText('Not saved')).toBeDefined();
  expect(screen.queryByRole('button', { name: /^Read/ })).toBeNull();
  view.rerender(<View item={{ ...read, resultPreview: { availability: 'available', source: { tool: 'Read', path: 'src/app.ts', callId: 'read-1' }, text: 'const retained = true;', truncated: true } }} actions={{ openPath }} />);
  fireEvent.click(screen.getByRole('button', { name: /^Read/ }));
  expect(screen.getByText('Result snippet · truncated')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Open current file' }));
  expect(openPath).toHaveBeenCalledExactlyOnceWith({ path: 'src/app.ts' });
  expect(postMessage).not.toHaveBeenCalled();
});

it('does not substitute a turn Diff for missing operation evidence and keeps Canvas independent', () => {
  const preview = vi.fn();
  const item: ToolTranscriptItem = { kind: 'tool', id: 'edit-row', turnId: 'turn-1', toolUseId: 'edit-1', toolName: 'ApplyPatch', action: 'Edited', status: 'running', progressCount: 0, latestUpdateKind: null, filePath: 'src/app.html' };
  function Scene({ settled }: { settled: boolean }) {
    return <ContentProvider value={{ workspaceRoot: null, theme: 'dark', actions: { openPath: vi.fn(), previewFile: preview, previewHtml: vi.fn() } }}>
      <View item={{ ...item, status: settled ? 'completed' : 'running' }} />
    </ContentProvider>;
  }
  const view = render(<Scene settled={false} />);
  expect(screen.queryByRole('button', { name: /^Edited/ })).toBeNull();
  view.rerender(<Scene settled />);
  expect(postMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));
  expect(preview).toHaveBeenCalledExactlyOnceWith('src/app.html');
  expect(postMessage).not.toHaveBeenCalled();
  expect(screen.getByText('This operation’s Diff was not recorded.')).toBeDefined();
  expect(screen.queryByRole('button', { name: /Review/ })).toBeNull();
  expect(postMessage).not.toHaveBeenCalled();
});

it('offers command copy and the live terminal mirror without inventing a background stop action', async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const terminal = vi.fn();
  const view = render(<View item={{ ...base, backgroundHint: { fireAndForget: true } }} actions={{ openTerminalMirror: terminal }} />);
  await user.click(screen.getByRole('button', { name: 'Command actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Copy command' }));
  expect(copy).toHaveBeenCalledExactlyOnceWith(base.detail);
  await user.click(screen.getByRole('menuitem', { name: 'View in terminal' }));
  expect(terminal).toHaveBeenCalledOnce();
  view.rerender(<View item={{ ...base, status: 'completed', backgroundHint: { fireAndForget: true } }} actions={{ openTerminalMirror: terminal }} />);
  expect(screen.queryByRole('menuitem', { name: 'View in terminal' })).toBeNull();
  expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
  expect(screen.getByText(/Keeps running until you stop it manually/)).toBeDefined();
});

it('uses the host-owned subagent row identity and live feed, without exposing child session ids', () => {
  const item = { ...base, detailKind: undefined, detail: undefined, outputTail: undefined, toolName: 'Task', action: 'Delegate analysis', status: 'completed' as const, subagent: { type: 'scout', description: 'Inspect the selected module', status: 'running' as const } };
  function Scene() {
    const flow = useSubagentPanelFlow(diff.port, diff.sessionId);
    return <SubagentActivityStoreContext.Provider value={flow.activityStore}><View item={item} actions={{ openSubagent: flow.openSubagent }} /></SubagentActivityStoreContext.Provider>;
  }
  render(<Scene />);
  act(() => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'subagent.activity', sequence: 1, sessionId: 'session-1', turnId: 'turn-1', toolUseId: 'tool-1', activities: [{ action: 'Read', target: 'src/app.ts' }],
  } })));
  expect(screen.getByText('Read · src/app.ts')).toBeDefined();
  expect(screen.getByText('Running in background')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /scout subagent/ }));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'subagent.open', sessionId: 'session-1', turnId: 'turn-1', toolUseId: 'tool-1' });
});

it('does not display historical workspace snapshots as assistant changes', () => {
  const openFileDiff = vi.fn();
  const openReviewTurn = vi.fn();
  render(<ToolActionsContext.Provider value={{ openFileDiff, openReviewTurn }}>
    <TranscriptRow messageId="message-1" streaming={false} grouped={false}
      item={{ kind: 'changes', id: 'changes-1', turnId: 'turn-1', files: [{ path: 'src/app.ts', additions: 2, deletions: 1 }] }} />
  </ToolActionsContext.Provider>);
  expect(screen.queryByText('src/app.ts')).toBeNull();
  expect(screen.queryByRole('button', { name: /changes/i })).toBeNull();
  expect(openFileDiff).not.toHaveBeenCalled();
  expect(openReviewTurn).not.toHaveBeenCalled();
});
