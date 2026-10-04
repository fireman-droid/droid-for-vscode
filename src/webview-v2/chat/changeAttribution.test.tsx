// @vitest-environment jsdom
import { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useStore } from 'zustand';
import { afterEach, expect, it, vi } from 'vitest';
import type { HostSnapshotMessage, WebviewToHostMessage } from '../../shared/bridgeMessages';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { InlineDiffContext } from '../review/useInlineDiff';
import { initialAssistantWebviewState } from '../state/initialState';
import type { StoreHostMessage } from '../state/types';
import { ProcessPresentationProvider } from './transcript/processPresentation';
import { describeTranscript } from './transcript/transcriptGroups';
import { resolveAssistantStatus } from './transcript/transcriptStatus';
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

function tool(operationDiff?: OperationDiff, overrides: Partial<ToolTranscriptItem> = {}): ToolTranscriptItem {
  return {
    kind: 'tool', id: 'edit-row', turnId, toolUseId: 'edit-call', toolName: 'ApplyPatch',
    action: 'Edit source', filePath: path, status: 'completed', progressCount: 0, latestUpdateKind: null,
    ...(operationDiff ? { operationDiff } : {}),
    ...overrides,
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
function Scene({ store, port, readOnly = false }: ReturnType<typeof fixture> & { readonly readOnly?: boolean }) {
  const state = useStore(store, (value) => value.state);
  const { descriptors, replyTails } = describeTranscript(state.transcript);
  const summaries = summarizeOperations(state.transcript);
  const context = useMemo(() => ({ port, sessionId, connected: true }), [port]);
  const following = useMemo(() => ({ current: { following: true } }), []);
  return <ToolActionsContext.Provider value={{}}><InlineDiffContext.Provider value={readOnly ? null : context}>
    <ProcessPresentationProvider messageIds={descriptors.map((item) => item.kind === 'user' ? item.item.id : item.id)} followingRef={following}>
      {descriptors.map((descriptor) => {
        if (descriptor.kind === 'user') return <p key={descriptor.item.id}>{descriptor.item.text}</p>;
        const summary = summaries.get(descriptor.turnId);
        const status = resolveAssistantStatus(descriptor.items, descriptor.turnId, state.turn);
        const operationsLive = state.turn?.turnId === descriptor.turnId
          ? ['submitting', 'streaming', 'stopping'].includes(state.turn.status) : status.type === 'running';
        return <AssistantReply key={descriptor.id} descriptor={descriptor} status={status}
          waiting={null} replyText={replyTails.get(descriptor.id)} completedAt={undefined} regenerate={undefined} fork={undefined}
          operationSummary={summary} operationsLive={operationsLive} readOnly={readOnly} />;
      })}
    </ProcessPresentationProvider>
    {!readOnly ? <ReviewDockSlot store={store} vscode={port} /> : null}
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
  expect(screen.queryByRole('region', { name: /^Changes in/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
  receive(current.store, { type: 'turn.state', sessionId, turnId, sequence: 3, status: 'completed' });
  updateWorkspace(current.store, 'settled');
  expect(screen.getByText(answer.kind === 'assistant' ? answer.text : '')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
});

it('keeps applied rows live through stopping, then folds only AI patches into a turn card', async () => {
  const current = fixture([user, tool(confirmed), answer]);
  render(<Scene {...current} />);
  updateWorkspace(current.store, 'writing');
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Changes in 1 file' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `Show changes to ${path}` }));
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  fireEvent.click(screen.getByRole('button', { name: `Review changes to ${path}` }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId, toolUseId: 'edit-call', path });
  await expectNoWorkspaceDiff(current.port);
  receive(current.store, { type: 'turn.state', sessionId, turnId, sequence: 3, status: 'stopping' });
  expect(screen.getByRole('button', { name: `Hide changes to ${path}` })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Changes in 1 file' })).toBeNull();
  updateWorkspace(current.store, 'settled');
  receive(current.store, { type: 'turn.state', sessionId, turnId, sequence: 5, status: 'completed' });
  const card = screen.getByRole('region', { name: 'Changes in 1 file' });
  expect(within(card).getByText('Edited 1 file')).toBeTruthy();
  expect(screen.queryByRole('button', { name: `Hide changes to ${path}` })).toBeNull();
  expect(screen.getByRole('button', { name: `Show changes to ${path}` })).toBeDefined();
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  const prose = screen.getByText(answer.kind === 'assistant' ? answer.text : '');
  expect(prose.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.compareDocumentPosition(screen.getByRole('button', { name: 'Copy reply' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(card).getByRole('button', { name: `Review changes to ${path}` }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId, path });
  fireEvent.click(within(card).getByRole('button', { name: 'Review changes in 1 file' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId });
  fireEvent.click(within(card).getByRole('button', { name: 'Undo changes in 1 file' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId, action: 'undo' });
  await expectNoWorkspaceDiff(current.port);
});

it.each([
  ['missing result', undefined],
  ['unavailable result', { status: 'unavailable', reason: 'not-recorded' }],
  ['proposed input', { status: 'ready', source: 'tool-input', files: [{ path, kind: 'modified', patch: aiPatch }] }],
  ['legacy successful input', { status: 'ready', source: 'successful-tool-input', files: [{ path, kind: 'modified', patch: aiPatch }] }],
  ['uncertain result', { status: 'ready', source: 'tool-result', files: [{ path, kind: 'modified', outcome: 'uncertain', patch: aiPatch }] }],
  ['failed result', { status: 'ready', source: 'tool-result', files: [{ path, kind: 'modified', outcome: 'failed', patch: aiPatch }] }],
  ['unchanged result', { status: 'ready', source: 'tool-result', files: [{ path, kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-same\n+same' }] }],
] satisfies [string, OperationDiff | undefined][])('does not promote %s to a confirmed change or fetch workspace text', async (_name, evidence) => {
  const current = fixture([user, tool(evidence), answer, changes], true);
  render(<Scene {...current} />);
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  expect(document.body.textContent).not.toContain('AI_ONLY_CHANGE');
  expect(screen.queryByRole('region', { name: /^Changes in/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
});

it('reports a confirmed write without inventing text when no result patch was recorded', async () => {
  const current = fixture([user, tool({ status: 'ready', source: 'tool-result', files: [
    { path, kind: 'added', outcome: 'applied', patch: '' },
  ] }), answer, changes]);
  render(<Scene {...current} />);
  fireEvent.click(screen.getByRole('button', { name: `Show changes to ${path}` }));
  expect(screen.getByText('No complete text Diff was recorded for this result.')).toBeTruthy();
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  receive(current.store, { type: 'turn.state', sessionId, turnId, sequence: 2, status: 'completed' });
  const card = screen.getByRole('region', { name: 'Changes in 1 file' });
  expect(within(card).queryByLabelText(/^Recorded operation lines:/)).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: 'Review changes in 1 file' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId });
  await expectNoWorkspaceDiff(current.port);
});

it('restores historical operation patches without restoring workspace-only reply blocks', async () => {
  const saved: SessionTranscriptItem[] = [user, tool(confirmed), answer, changes,
    { ...changes, id: 'orphan-workspace', turnId: 'workspace-only-turn' }];
  const current = fixture();
  const view = render(<Scene {...current} readOnly />);
  receive(current.store, snapshot(saved, 2, true));
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `Show changes to ${path}` }));
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  expect(screen.getAllByRole('region', { name: 'Changes in 1 file' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /^Undo changes/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Review changes/ })).toBeNull();
  await expectNoWorkspaceDiff(current.port);
  view.unmount();
  const restored = fixture(saved, true);
  render(<Scene {...restored} readOnly />);
  fireEvent.click(screen.getByRole('button', { name: `Show changes to ${path}` }));
  expect(screen.getByRole('region', { name: `Diff for ${path}` }).textContent).toContain('AI_ONLY_CHANGE');
  expect(screen.getAllByRole('region', { name: 'Changes in 1 file' })).toHaveLength(1);
  expect(restored.port.postMessage).not.toHaveBeenCalled();
  await expectNoWorkspaceDiff(restored.port);
});

it('keeps changes to the same file in separate turn cards and routes each review to its own turn', () => {
  const secondTurn = 'second-turn';
  const current = fixture([user, tool(confirmed), answer,
    { kind: 'user', id: 'second-question', text: 'Change it again' },
    tool(confirmed, { id: 'second-edit', turnId: secondTurn }),
    { kind: 'assistant', id: 'second-answer', turnId: secondTurn, text: 'Second change completed.' },
  ], true);
  render(<Scene {...current} />);
  const cards = screen.getAllByRole('region', { name: 'Changes in 1 file' });
  expect(cards).toHaveLength(2);
  cards.forEach((card) => expect(within(card).getAllByLabelText('Recorded operation lines: 1 added, 1 removed')).toHaveLength(2));
  fireEvent.click(within(cards[0]!).getByRole('button', { name: `Review changes to ${path}` }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId, path });
  fireEvent.click(within(cards[1]!).getByRole('button', { name: `Review changes to ${path}` }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId: secondTurn, path });
});

it('reveals files beyond the first three without changing the turn review or undo scope', () => {
  const files = Array.from({ length: 5 }, (_, index) => ({ path: `src/file-${index + 1}.ts`, kind: 'modified' as const, outcome: 'applied' as const, patch: aiPatch }));
  const current = fixture([user, tool({ status: 'ready', source: 'tool-result', callId: 'many-files', files }), answer], true);
  render(<Scene {...current} />);
  const card = screen.getByRole('region', { name: 'Changes in 5 files' });
  expect(within(card).getAllByRole('button', { name: /^Review changes to/ })).toHaveLength(3);
  expect(within(card).queryByRole('button', { name: 'Review changes to src/file-5.ts' })).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: 'Show 2 more files' }));
  expect(within(card).getAllByRole('button', { name: /^Review changes to/ })).toHaveLength(5);
  fireEvent.click(within(card).getByRole('button', { name: 'Review changes to src/file-5.ts' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId, path: 'src/file-5.ts' });
  fireEvent.click(within(card).getByRole('button', { name: 'Undo changes in 5 files' }));
  expect(current.port.postMessage).toHaveBeenLastCalledWith({ type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId, action: 'undo' });
  fireEvent.click(within(card).getByRole('button', { name: 'Show less' }));
  expect(within(card).getAllByRole('button', { name: /^Review changes to/ })).toHaveLength(3);
});

it('opens every recorded patch in a read-only summary without offering review or write actions', () => {
  const second: OperationDiff = { status: 'ready', source: 'tool-result', callId: 'second-call', files: [
    { path, kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-AI_ONLY_CHANGE\n+SECOND_AI_CHANGE' },
  ] };
  const summary = summarizeOperations([tool(confirmed), tool(second, { id: 'second-edit', toolUseId: 'second-call' })]).get(turnId)!;
  render(<AiOperationSummary summary={summary} />);
  expect(screen.queryByRole('region', { name: `Diff for ${path}` })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `Show changes to ${path}` }));
  const details = screen.getAllByRole('region', { name: `Diff for ${path}` });
  expect(details).toHaveLength(2);
  expect(details[0]!.textContent).toContain('AI_ONLY_CHANGE');
  expect(details[1]!.textContent).toContain('SECOND_AI_CHANGE');
  expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
});
