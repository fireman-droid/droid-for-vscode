import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { HostToWebviewMessage } from '../../../shared/bridgeMessages';
import type { ToolSubagentSummary } from '../../../shared/protocol/transcript';
import { createHostTranscriptState } from '../../recovery/hostTranscriptState';
import type { UnsequencedHostMessage } from '../hostTypes';
import { handleSubagentPanel } from '../subagents/subagentPanel';
import type { SubagentPanelPort } from '../subagents/subagentPanelPort';
import type { SubagentTranscriptService } from '../subagents/SubagentTranscriptService';
import { createTurnActivityState } from './turnActivityState';
import { handleRuntimeEvent, projectTranscript } from './turnRuntimeEvents';
import type { TurnRuntimeEventPort, TurnTranscriptPort } from './turnFlowPort';
import { TurnState } from './TurnState';

const identity = { type: 'worker', description: 'Mission readiness check' };

function harness() {
  const turnState = new TurnState();
  turnState.turn = { turnId: 'turn-1', status: 'streaming', activity: createTurnActivityState() };
  let listener: Parameters<SubagentTranscriptService['subscribeParent']>[1] | undefined;
  const messages: HostToWebviewMessage[] = [];
  const port = {
    sessionState: { sessionId: 'session-1', activeRuntimeCwd: 'd:/sandbox', disposed: false },
    recoveryState: { transcript: createHostTranscriptState('complete') },
    turnState,
    effects: {
      flushPendingThinking: vi.fn(),
      handleMissionRuntimeEvent: () => false,
      mirrorExecuteEvent: vi.fn(),
      recordLiveToolChanges: vi.fn(),
      scheduleLiveSubagentSync: vi.fn(),
      scheduleRecoveryCheckpoint: vi.fn(),
    },
    sessionHistory: { loadSubagentInvocations: async () => [] },
    subagentState: {
      subagentTranscripts: {
        subscribeParent: (_sessionId: string, callback: NonNullable<typeof listener>) => {
          listener = callback;
          return () => { listener = undefined; };
        },
        syncParent: async () => undefined,
      },
    },
    emit(message: UnsequencedHostMessage) {
      const sequenced = { ...message, sequence: messages.length } as HostToWebviewMessage;
      projectTranscript(port as unknown as TurnTranscriptPort, sequenced);
      messages.push(sequenced);
    },
  };
  handleSubagentPanel(port as unknown as SubagentPanelPort, 'session-1', true);
  const runtime = (event: Exclude<RuntimeEvent, { type: 'turn-complete' }>) =>
    handleRuntimeEvent(port as unknown as TurnRuntimeEventPort, 'session-1', turnState.turn!.turnId, event);
  const start = (toolUseId = 'task-1') => runtime({
    type: 'tool-start', toolName: 'Task', toolUseId, action: 'Delegate task', subagent: identity,
  });
  const notification = (toolUseId = 'task-1') => runtime({
    type: 'subagent-started', toolUseId, subagentType: identity.type,
    description: identity.description, startedAt: 1000,
  });
  const result = (toolUseId = 'task-1') => runtime({
    type: 'tool-result', toolName: 'Task', toolUseId, action: 'Delegate task', isError: false,
  });
  const lifecycle = (
    status: 'working' | 'completed' | 'failed' | 'cancelled',
    turnId = 'turn-1', toolUseId = 'task-1',
  ) => listener!(turnId, toolUseId, [], status);
  const row = (turnId = 'turn-1', toolUseId = 'task-1') =>
    port.recoveryState.transcript.transcript.find(item =>
      item.kind === 'tool' && item.turnId === turnId && item.toolUseId === toolUseId);
  return { port, messages, turnState, start, notification, result, lifecycle, row };
}

describe('child lifecycle and parent tool event ordering', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)(
    'keeps child %s when a late start notification precedes the Task result', status => {
      const h = harness();
      h.start();
      h.lifecycle(status);
      expect(h.row()).toMatchObject({ status: 'running', subagent: { status } });

      // Observed in the real Mission stream: the child has already settled
      // before the parent forwards child_session_available and Task's result.
      h.notification();
      h.result();

      expect(h.row()).toMatchObject({ status: 'completed', subagent: { status } });
      expect(h.messages.filter(message => message.type === 'tool.activity').at(-1))
        .toMatchObject({ status: 'completed', subagent: { status } });
    },
  );

  it('accepts a resumed child lifecycle without reviving another completed invocation', () => {
    const h = harness();
    h.start();
    h.lifecycle('completed');
    h.result();

    h.lifecycle('working');
    h.result();
    expect(h.row()).toMatchObject({ subagent: { status: 'running' } });
    h.lifecycle('completed');
    h.start('task-2');
    h.notification('task-2');
    expect(h.row('turn-1', 'task-2')).toMatchObject({ subagent: { status: 'running' } });
    expect(h.row()).toMatchObject({ subagent: { status: 'completed' } });
  });

  it('settles an earlier turn without leaking its status into the current turn or another session', () => {
    const h = harness();
    h.start();
    h.notification();
    h.result();
    h.turnState.turn = { turnId: 'turn-2', status: 'streaming', activity: createTurnActivityState() };
    h.start();
    h.lifecycle('completed', 'turn-1');
    h.port.emit({ type: 'subagent.update', sessionId: 'other-session', turnId: 'turn-2',
      toolUseId: 'task-1', subagent: { ...identity, status: 'failed' } as ToolSubagentSummary });
    h.notification();
    h.result();

    expect(h.row('turn-1')).toMatchObject({ subagent: { status: 'completed' } });
    expect(h.row('turn-2')).toMatchObject({ status: 'completed', subagent: { status: 'running' } });
  });
});
