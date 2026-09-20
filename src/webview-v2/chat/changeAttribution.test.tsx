// @vitest-environment jsdom
import { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from 'zustand';
import { afterEach, expect, it, vi } from 'vitest';
import type { HostSnapshotMessage, WebviewToHostMessage } from '../../shared/bridgeMessages';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { InlineDiffContext } from '../../webview/assistant/changes/useInlineDiff';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';
import type { StoreHostMessage } from '../../webview/assistant/state/types';
import { ProcessPresentationProvider } from '../../webview/assistant/transcript/processPresentation';
import { describeTranscript } from '../../webview/assistant/transcript/transcriptGroups';
import { resolveAssistantStatus } from '../../webview/assistant/transcript/transcriptStatus';
import { ToolActionsContext } from '../content/toolActions';
import { AiOperationSummary, summarizeOperations } from './AiOperationSummary';
import { AssistantReply } from './AssistantReply';
import { ReviewDockSlot } from './ReviewDock';
import { createChatStore, type ChatStore } from './store';

afterEach(cleanup);

const sessionId = 'session-attribution';
const turnId = 'turn-attribution';
const path = 'src/shared.ts';
const aiPatch = '@@ -1,1 +1,1 @@\n-original\n+AI_ONLY_CHANGE';
const workspacePatch = '@@ -1,2 +1,2 @@\n-original\n-old manual line\n+AI_ONLY_CHANGE\n+USER_ONLY_CHANGE';
const user: SessionTranscriptItem = { kind: 'user', id: 'question', text: 'Explain this function' };
const answer: SessionTranscriptItem = { kind: 'assistant', id: 'answer', turnId, text: 'This function creates a channel.' };
const changes: SessionTranscriptItem = {
  kind: 'changes', id: 'workspace-changes', turnId,
  files: [{ path, additions: 2, deletions: 2 }, { path: 'manual-only.ts', additions: 1, deletions: 0 }],
};
const confirmed: OperationDiff = {
  status: 'ready', source: 'tool-result', callId: 'edit-call', sourceSessionId: sessionId,
  files: [{ path, kind: 'modified', outcome: 'applied', patch: aiPatch }],
};

function tool(operationDiff?: OperationDiff): ToolTranscriptItem {
  return {
    kind: 'tool', id: 'edit-row', turnId, toolUseId: 'edit-call', toolName: 'ApplyPatch',
    action: 'Edit source', filePath: path, status: 'completed', progressCount: 0, latestUpdateKind: null,
    ...(operationDiff ? { operationDiff } : {}),
  };
}

function snapshot(transcript: readonly SessionTranscriptItem[], sequence = 1, completed = false): HostSnapshotMessage {
  return {
    type: 'host.snapshot', sequence, sessionId, conversationId: 'conversation-attribution',
    connection: { status: 'connected' }, turn: { turnId, status: completed ? 'completed' : 'streaming' },
    sessions: initialAssistantWebviewState.sessions, settings: initialAssistantWebviewState.settings,
    context: initialAssistantWebviewState.context, modelCatalog: initialAssistantWebviewState.modelCatalog,
    transcript, historyStatus: 'complete', truncated: false,
  };
}

function fixture(transcript: readonly SessionTranscriptItem[] = [user, answer], completed = false) {
  const store = createChatStore();
  store.getState().dispatch({ type: 'host.message', message: snapshot(transcript, 1, completed) });
  const postMessage = vi.fn((message: WebviewToHostMessage) => {
    if (message.type === 'file.readDiff') queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
      data: { ...message, type: 'file.diff', sequence: 100,
        result: { status: 'ready', phase: 'live', patch: workspacePatch, truncated: false } },
    })));
  });
  return { store, port: { postMessage } };
}

// Render the production grouping and reply chain without transcript virtualization.
function Scene({ store, port }: ReturnType<typeof fixture>) {
  const state = useStore(store, (value) => value.state);
  const { descriptors, replyTails } = describeTranscript(state.transcript);
  const summaries = summarizeOperations(state.transcript);
  const context = useMemo(() => ({ port, sessionId, connected: true }), [port]);
  const following = useMemo(() => ({ current: { following: true } }), []);
  return <ToolActionsContext.Provider value={{}}><InlineDiffContext.Provider value={context}>
    <ProcessPresentationProvider messageIds={descriptors.map((item) => item.kind === 'user' ? item.item.id : item.id)} followingRef={following}>
      {descriptors.map((descriptor) => {
        if (descriptor.kind === 'user') return <p key={descriptor.item.id}>{descriptor.item.text}</p>;
        const summary = summaries.get(descriptor.turnId);
        return <div key={descriptor.id}>
          <AssistantReply descriptor={descriptor} status={resolveAssistantStatus(descriptor.items, descriptor.turnId, state.turn)}
            waiting={null} replyText={replyTails.get(descriptor.id)} completedAt={undefined} regenerate={undefined} fork={undefined} />
          {summary ? <AiOperationSummary summary={summary} /> : null}
        </div>;
      })}
    </ProcessPresentationProvider>
    <ReviewDockSlot store={store} vscode={port} />
  </InlineDiffContext.Provider></ToolActionsContext.Provider>;
}

function receive(store: ChatStore, message: StoreHostMessage) {
  act(() => store.getState().dispatch({ type: 'host.message', message }));
}

function updateWorkspace(store: ChatStore, state: 'writing' | 'settled') {
  receive(store, {
    type: 'changes.update', sessionId, turnId, sequence: store.getState().state.sequence + 1, state,
    files: changes.kind === 'changes' ? changes.files : [],
  });
}

async function expectNoWorkspaceDiff(port: ReturnType<typeof fixture>['port']) {
  // Let the real inline-diff request queue run if an unintended preview mounted.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(port.postMessage.mock.calls.some(([message]) => message.type === 'file.readDiff' || message.type === 'file.openTurnDiff')).toBe(false);
  expect(screen.queryByText('Workspace changes')).toBeNull();
  expect(document.body.textContent).not.toContain('USER_ONLY_CHANGE');
  expect(document.body.textContent).not.toContain('manual-only.ts');
}

it('keeps manual saves out of a pure answer during writing and after settlement', async () => {
  const current = fixture();
  render(<Scene {...current} />);
  updateWorkspace(current.store, 'writing');
  expect(current.store.getState().state.transcript.some((item) => item.kind === 'changes')).toBe(true);
  expect(screen.queryByRole('group', { name: 'AI operation summary' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
  receive(current.store, { type: 'turn.state', sessionId, turnId, sequence: 3, status: 'completed' });
  updateWorkspace(current.store, 'settled');
  expect(screen.getByText(answer.kind === 'assistant' ? answer.text : '')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
});

it('shows only the applied operation patch when the user also edits the same file', async () => {
  const current = fixture([user, tool(confirmed), answer]);
  render(<Scene {...current} />);
  updateWorkspace(current.store, 'writing');
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  expect(screen.getByRole('button', { name: /^AI operations/ }).textContent).toContain('1 directly confirmed file');
  await expectNoWorkspaceDiff(current.port);
  updateWorkspace(current.store, 'settled');
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId, path });
  fireEvent.click(screen.getByRole('button', { name: 'Open Review' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId });
  await expectNoWorkspaceDiff(current.port);
});

it.each([
  ['missing result', undefined],
  ['unavailable result', { status: 'unavailable', reason: 'not-recorded' }],
  ['proposed input', { status: 'ready', source: 'tool-input', files: [{ path, kind: 'modified', patch: aiPatch }] }],
  ['legacy successful input', { status: 'ready', source: 'successful-tool-input', files: [{ path, kind: 'modified', patch: aiPatch }] }],
  ['uncertain result', { status: 'ready', source: 'tool-result', files: [{ path, kind: 'modified', outcome: 'uncertain', patch: aiPatch }] }],
  ['failed result', { status: 'ready', source: 'tool-result', files: [{ path, kind: 'modified', outcome: 'failed', patch: aiPatch }] }],
] satisfies [string, OperationDiff | undefined][])('does not promote %s to a confirmed change or fetch workspace text', async (_name, evidence) => {
  const current = fixture([user, tool(evidence), answer, changes], true);
  render(<Scene {...current} />);
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  expect(document.body.textContent).not.toContain('AI_ONLY_CHANGE');
  expect(document.body.textContent).not.toContain('1 directly confirmed file');
  expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
});

it('reports a confirmed write without inventing text when no result patch was recorded', async () => {
  const current = fixture([user, tool({ status: 'ready', source: 'tool-result', files: [
    { path, kind: 'added', outcome: 'applied', patch: '' },
  ] }), answer, changes], true);
  render(<Scene {...current} />);
  expect(screen.getByText('No complete text Diff was recorded for this result.')).toBeTruthy();
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  expect(screen.getByRole('button', { name: /^AI operations/ }).textContent).toContain('1 directly confirmed file');
  fireEvent.click(screen.getByRole('button', { name: 'Open Review' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId });
  await expectNoWorkspaceDiff(current.port);
});

it('restores historical operation patches without restoring workspace-only reply blocks', async () => {
  const saved: SessionTranscriptItem[] = [user, tool(confirmed), answer, changes,
    { ...changes, id: 'orphan-workspace', turnId: 'workspace-only-turn' }];
  const current = fixture();
  const view = render(<Scene {...current} />);
  receive(current.store, snapshot(saved, 2, true));
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  expect(screen.getAllByRole('button', { name: 'Copy reply' })).toHaveLength(1);
  await expectNoWorkspaceDiff(current.port);
  view.unmount();
  const restored = fixture(saved, true);
  render(<Scene {...restored} />);
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  expect(screen.getAllByRole('button', { name: 'Copy reply' })).toHaveLength(1);
  await expectNoWorkspaceDiff(restored.port);
});
