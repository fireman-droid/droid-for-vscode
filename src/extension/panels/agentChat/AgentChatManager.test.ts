import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatNavigationMessage } from '../../../shared/protocol/agentChatProtocol';
import type { SessionTranscriptItem, ToolSubagentSummary } from '../../../shared/protocol/transcript';
import type { ChatController } from '../../chat/ChatController';
import type { ChatControllerListener, ControllerHostMessage } from '../../chat/hostTypes';
import type { CurrentTurn } from '../../chat/internals';
import { createTurnActivityState } from '../../chat/turns/turnActivityState';
import { createHostTranscriptState, projectHostTranscriptMessage } from '../../recovery/hostTranscriptState';
import type { AgentChatPanelOptions } from './AgentChatPanel';
import { AgentChatManager } from './AgentChatManager';

const mocks = vi.hoisted(() => ({
  panels: [] as AgentChatPanelOptions[],
  warning: vi.fn(),
}));
vi.mock('vscode', () => ({
  window: { showWarningMessage: mocks.warning },
  commands: { executeCommand: vi.fn() },
}));
vi.mock('./AgentChatPanel', () => ({
  AgentChatPanel: class {
    constructor(options: AgentChatPanelOptions) { mocks.panels.push(options); }
    reveal() {}
    dispose() {}
  },
}));

const cleanup: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); mocks.panels.length = 0; mocks.warning.mockClear(); });
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.useRealTimers(); });

function user(id: string): SessionTranscriptItem {
  return { kind: 'user', id, text: id };
}

function task(id: string, status?: ToolSubagentSummary['status']): SessionTranscriptItem {
  return {
    kind: 'tool', id: `tool-${id}`, turnId: `recovered-turn-${id}`, toolUseId: id,
    toolName: 'Task', action: 'Delegate task', progressCount: 0, latestUpdateKind: null,
    status: 'completed', subagent: { type: 'worker', description: id, ...(status ? { status } : {}) },
  };
}

function controller(sessionId: string, transcript: readonly SessionTranscriptItem[] = []) {
  const listeners = new Set<ChatControllerListener>();
  const state = {
    sessionState: { sessionId, conversationId: `conversation-${sessionId}`,
      activeRuntimeCwd: 'C:/workspace', connection: { status: 'connected' } },
    recoveryState: { transcript: { ...createHostTranscriptState('complete'), transcript } },
    turnState: { turn: null as CurrentTurn | null },
    missionState: { missionRuntime: null },
    subagentState: { subagentTranscripts: undefined },
    subscribe: (listener: ChatControllerListener) => {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    handleMessage: vi.fn(),
  };
  const emit = (message: ControllerHostMessage) => {
    for (const listener of listeners) listener(message);
  };
  const notifyTurn = () => emit({ type: 'turn.state', sequence: 1, sessionId,
    turnId: state.turnState.turn?.turnId ?? 'live-turn', status: state.turnState.turn?.status ?? 'submitting' });
  return { state, value: state as unknown as ChatController, emit, notifyTurn };
}

function harness(transcript: readonly SessionTranscriptItem[]) {
  const root = controller('parent', transcript);
  const children = new Map<string, ReturnType<typeof controller>>();
  const createChild = vi.fn(({ sessionId }: { sessionId: string; cwd: string }) => {
    const child = controller(sessionId);
    children.set(sessionId, child);
    return { controller: child.value, openReview: vi.fn(), dispose: vi.fn() };
  });
  const manager = new AgentChatManager({
    root: root.value, extensionUri: {} as vscode.Uri,
    diagnostics: { record: vi.fn() }, createChild,
  });
  cleanup.push(() => manager.dispose());
  const messages: AgentChatNavigationMessage[] = [];
  manager.navigation.subscribe(message => messages.push(message));
  manager.navigation.replay();
  const latest = () => messages.at(-1)!;
  const titles = () => latest().agents.map(agent => agent.title);
  const openTask = (toolUseId: string) => manager.openTask({
    parentSessionId: 'parent', childSessionId: `child-${toolUseId}`, toolUseId,
    title: toolUseId, cwd: 'C:/workspace',
  });
  return { manager, root, children, createChild, latest, titles, openTask };
}

describe('Agent composer scope', () => {
  it('keeps this prompt’s finished work until the next accepted user message', () => {
    const h = harness([user('first'), task('finished', 'completed'), task('still-running', 'running')]);
    expect(h.titles()).toEqual(['finished', 'still-running']);

    h.root.state.recoveryState.transcript.transcript = [
      ...h.root.state.recoveryState.transcript.transcript, user('second'),
    ];
    h.root.notifyTurn();
    vi.advanceTimersByTime(80);
    expect(h.titles()).toEqual(['still-running']);
    expect(h.latest().agents[0]).toMatchObject({ status: 'running', canStop: true });
  });

  it('hides earlier terminal tasks after replay and manager reconstruction', () => {
    const history = [user('first'), task('done', 'completed'), task('failed', 'failed'),
      task('stopped', 'cancelled'), task('unresolved'), user('second'), task('current', 'completed')];
    const first = harness(history);
    first.manager.navigation.replay();
    expect(first.titles()).toEqual(['unresolved', 'current']);
    first.manager.dispose();

    const reopened = harness(history);
    expect(reopened.titles()).toEqual(['unresolved', 'current']);
    reopened.root.state.turnState.turn = {
      turnId: 'automatic-followup', status: 'streaming', activity: createTurnActivityState(),
    };
    reopened.root.notifyTurn();
    vi.advanceTimersByTime(80);
    expect(reopened.titles()).toEqual(['unresolved', 'current']);
  });

  it('opens hidden historical tasks and retains complete navigation in their child view', () => {
    const h = harness([user('first'), task('older', 'completed'), user('second'), task('current', 'completed')]);
    expect(h.titles()).toEqual(['current']);
    h.openTask('older');

    expect(h.createChild).toHaveBeenCalledWith({ sessionId: 'child-older', cwd: 'C:/workspace' });
    expect(mocks.warning).not.toHaveBeenCalled();
    const childNavigation: AgentChatNavigationMessage[] = [];
    mocks.panels[0]!.navigation.subscribe(message => childNavigation.push(message as AgentChatNavigationMessage));
    mocks.panels[0]!.navigation.replay();
    const latest = childNavigation.at(-1)!;
    expect(latest.agents.map(agent => agent.title)).toEqual(['older', 'current']);
    expect(latest.agents.find(agent => agent.key === latest.currentKey)?.title).toBe('older');
    expect(h.titles()).toEqual(['current']);
  });

  it('retains an older task when its child has resumed despite a completed parent record', () => {
    const h = harness([user('first'), task('resumed', 'completed'), user('second')]);
    h.openTask('resumed');
    const child = h.children.get('child-resumed')!;
    child.state.turnState.turn = {
      turnId: 'child-followup', status: 'streaming', activity: createTurnActivityState(),
    };
    child.notifyTurn();
    vi.advanceTimersByTime(80);
    expect(h.latest().agents).toEqual([expect.objectContaining({ title: 'resumed', status: 'running', canStop: true })]);

    child.state.turnState.turn.status = 'completed';
    child.notifyTurn();
    vi.advanceTimersByTime(80);
    expect(h.titles()).toEqual([]);
  });

  it('removes an earlier running task when its late result settles in the original transcript position', () => {
    const h = harness([user('first'), task('background', 'running'), user('second')]);
    expect(h.titles()).toEqual(['background']);
    const message = { type: 'subagent.update', sequence: 2, sessionId: 'parent',
      turnId: 'recovered-turn-background', toolUseId: 'background',
      subagent: { type: 'worker', description: 'background', status: 'completed' } } as const;
    h.root.state.recoveryState.transcript = projectHostTranscriptMessage(h.root.state.recoveryState.transcript, message);
    h.root.emit(message);
    vi.advanceTimersByTime(80);
    expect(h.titles()).toEqual([]);
    expect(h.root.state.recoveryState.transcript.transcript.map(item => item.id))
      .toEqual(['first', 'tool-background', 'second']);
    h.manager.navigation.replay();
    expect(h.titles()).toEqual([]);
  });
});
