import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionHistoryLoader, SessionHistoryResult } from '../../../runtime/history/SessionHistory';
import { projectSessionMessages } from '../../../runtime/history/projectSessionHistory';
import type { SubagentEvent, SubagentEventSource } from '../../../runtime/daemon/daemonNotificationSource';
import type { SubagentInvocationRecord } from '../../../runtime/subagents/subagentSummary';
import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { SubagentTranscriptService } from './SubagentTranscriptService';

const cwd = 'C:/workspace';
const parent = { parentSessionId: 'parent', turnId: 'parent-turn', toolUseId: 'task-raw',
  type: 'worker', description: 'Migrate editor settings', cwd };
const task: Extract<SessionTranscriptItem, { kind: 'tool' }> = {
  kind: 'tool', id: 'task-row', turnId: parent.turnId, toolUseId: parent.toolUseId,
  toolName: 'Task', action: 'Delegate task', status: 'running', progressCount: 0, latestUpdateKind: null,
  subagent: { type: parent.type, description: parent.description },
};
const invocation = (status: 'running' | 'completed' = 'running'): SubagentInvocationRecord => ({
  parentToolUseId: parent.toolUseId, childSessionId: 'child',
  summary: { ...task.subagent!, status },
});
const message = (id: string, role: string, content: unknown[]) => ({ id, role, content, createdAt: 0, updatedAt: 0 });
const text = (value: string) => ({ type: 'text', text: value });
const tool = { type: 'tool_use', id: 'read-raw', name: 'Read', input: { file_path: 'src/settings.ts' } };
const snapshot = (messages: unknown[], sessionId = 'child'): SessionHistoryResult =>
  projectSessionMessages(messages, { workspaceRoot: cwd, sourceSessionId: sessionId });
const empty = (): SessionHistoryResult => ({ status: 'available',
  state: { transcript: [], historyStatus: 'complete', truncated: false } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
const services: SubagentTranscriptService[] = [];

function harness() {
  const listeners = new Set<(event: SubagentEvent) => void>();
  const source: SubagentEventSource = {
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    watch: vi.fn(), dispose: vi.fn(),
  };
  const loadHistory = vi.fn<SessionHistoryLoader['loadHistory']>().mockResolvedValue(empty());
  const loadInvocations = vi.fn<NonNullable<SessionHistoryLoader['loadSubagentInvocations']>>()
    .mockResolvedValue([invocation()]);
  let rowAvailable = true;
  const openViewer = vi.fn();
  const service = new SubagentTranscriptService({ loadHistory, loadSubagentInvocations: loadInvocations }, {
    source, resolveParentRow: () => rowAvailable ? parent : null, openViewer,
  });
  services.push(service);
  const emit = (event: SubagentEvent) => { for (const listener of listeners) listener(event); };
  return { service, loadHistory, loadInvocations, source, openViewer, emit,
    rowAvailable: (value: boolean) => { rowAvailable = value; },
    available: () => emit({ type: 'child-available', sessionId: 'parent', childSessionId: 'child', toolUseId: parent.toolUseId }),
  };
}

afterEach(() => { for (const service of services.splice(0)) service.dispose(); });

describe('child transcript dispatch and recovery', () => {
  it('keeps dispatch pending and consumes an early child identity after the parent row arrives', async () => {
    const h = harness(); h.rowAvailable(false);
    h.available();
    expect(h.service.readViewer('child')).toBeNull();
    await h.service.syncParent('parent', cwd, [task], []);
    expect(h.service.readParentOperationEvidence('parent').notices.map(notice => notice.reason)).toEqual(['pending']);
    h.rowAvailable(true);
    await h.service.syncParent('parent', cwd, [task], []);
    await settle();
    expect(h.service.open('parent', parent.turnId, parent.toolUseId)).toBe(true);
    expect(h.service.isParentRunning('parent', parent.turnId)).toBe(true);
    expect(h.service.readParentOperationEvidence('parent').notices).toEqual([]);
  });

  it('publishes live tool activity immediately while the initial history read is pending', async () => {
    const h = harness(), history = deferred<SessionHistoryResult>();
    h.loadHistory.mockReturnValueOnce(history.promise);
    const activity = vi.fn(); h.service.subscribeParent('parent', activity);
    h.available();
    h.emit({ type: 'assistant-turn', sessionId: 'child', messageId: 'assistant-1' });
    h.emit({ type: 'runtime', sessionId: 'child', event: {
      type: 'tool-start', toolUseId: 'read-raw', toolName: 'Read', action: 'Read settings', target: 'src/settings.ts',
    } });
    expect(h.service.readViewer('child')?.items).toEqual([expect.objectContaining({ kind: 'tool', toolUseId: 'read-raw' })]);
    expect(activity).toHaveBeenLastCalledWith(parent.turnId, parent.toolUseId,
      [{ action: 'Read settings', target: 'src/settings.ts' }], 'working');
    expect(h.service.readParentOperationEvidence('parent').notices.map(notice => notice.reason)).toEqual(['pending']);
    history.resolve(snapshot([message('assistant-1', 'assistant', [tool])]));
    await settle();
    expect(h.service.readViewer('child')?.items.filter(item => item.kind === 'tool')).toHaveLength(1);
    expect(h.service.readParentOperationEvidence('parent').notices).toEqual([]);
  });

  it('starts a post-attachment read after an older read settles and does not duplicate concurrent live text', async () => {
    const h = harness(), first = deferred<SessionHistoryResult>(), resumed = deferred<SessionHistoryResult>();
    h.loadHistory.mockReturnValueOnce(first.promise).mockReturnValueOnce(resumed.promise);
    h.available();
    h.emit({ type: 'assistant-turn', sessionId: 'child', messageId: 'assistant-1' });
    h.emit({ type: 'runtime', sessionId: 'child', event: { type: 'text-delta', text: 'Starting' } });
    h.emit({ type: 'resync', sessionId: 'child' });
    expect(h.loadHistory).toHaveBeenCalledOnce();
    first.resolve(snapshot([message('assistant-1', 'assistant', [text('Starting')])]));
    await settle(); expect(h.loadHistory).toHaveBeenCalledTimes(2);
    h.emit({ type: 'runtime', sessionId: 'child', event: { type: 'text-delta', text: ' continued' } });
    resumed.resolve(snapshot([message('assistant-1', 'assistant', [text('Starting continued')])]));
    await settle();
    const replies = h.service.readViewer('child')?.items.filter(item => item.kind === 'assistant');
    expect(replies).toEqual([expect.objectContaining({ text: 'Starting continued' })]);
  });

  it('settles a child that completed while notifications were disconnected', async () => {
    const h = harness(), activity = vi.fn();
    h.service.subscribeParent('parent', activity); h.available(); await settle();
    h.loadInvocations.mockResolvedValue([invocation('completed')]);
    h.loadHistory.mockResolvedValue(snapshot([message('assistant-final', 'assistant', [text('Migration complete')])]));
    h.emit({ type: 'resync', sessionId: 'child' }); await settle();
    expect(h.service.readViewer('child')).toMatchObject({ running: false, lifecycle: 'completed',
      items: [expect.objectContaining({ text: 'Migration complete' })] });
    expect(h.source.watch).toHaveBeenLastCalledWith('child', cwd, false);
    expect(activity.mock.calls.at(-1)?.[3]).toBe('completed');
    expect(h.service.isParentRunning('parent', parent.turnId)).toBe(false);
  });

  it('maps a replayed Task by its raw tool id rather than its display description', async () => {
    const h = harness();
    const history = snapshot([message('parent-message', 'assistant', [{ type: 'tool_use',
      id: parent.toolUseId, name: 'Task', input: { subagent_type: 'worker', description: 'Different display wording' } }])], 'parent');
    expect(history.status).toBe('available');
    if (history.status !== 'available') throw new Error('fixture projection unavailable');
    const row = history.state.transcript.find(item => item.kind === 'tool');
    expect(row?.kind === 'tool' ? row.toolUseId : null).toBe(parent.toolUseId);
    await h.service.syncParent('parent', cwd, history.state.transcript, [invocation()]); await settle();
    expect(row && 'turnId' in row && h.service.open('parent', row.turnId!, parent.toolUseId)).toBe(true);
    expect(h.service.readParentOperationEvidence('parent').notices).toEqual([]);
  });

  it('applies progress and completion to a tool discovered in history without requiring another assistant message', async () => {
    const h = harness();
    h.loadHistory.mockResolvedValue(snapshot([message('assistant-running', 'assistant', [tool])]));
    h.available(); await settle();
    h.emit({ type: 'runtime', sessionId: 'child', event: { type: 'tool-progress', toolUseId: 'read-raw',
      toolName: 'Read', action: 'Read settings', updateKind: 'status' } });
    expect(h.service.readViewer('child')?.items.find(item => item.kind === 'tool')).toMatchObject({ progressCount: 1 });
    h.emit({ type: 'runtime', sessionId: 'child', event: { type: 'tool-result', toolUseId: 'read-raw',
      toolName: 'Read', action: 'Read settings', isError: false } });
    expect(h.service.readViewer('child')?.items.filter(item => item.kind === 'tool')).toEqual([
      expect.objectContaining({ toolUseId: 'read-raw', status: 'completed' }),
    ]);
  });
});
