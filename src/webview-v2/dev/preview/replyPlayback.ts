import type { HostToWebviewMessage, HostSnapshotMessage } from '../../../shared/bridgeMessages';
import { parseWebviewMessage } from '../../../shared/validateMessage';
import { MAX_QUEUED_MESSAGES } from '../../../shared/protocol/queueProtocol';
import { TURN_SEND_REJECTED_CODE } from '../../../shared/protocol/turns';
import { assistantWebviewReducer, initialAssistantWebviewState, isTurnActive } from '../../state/store';
import type { StoreHostMessage } from '../../state/types';
import { replyTimeline } from './replyTimeline';
import type { SubagentInspectMessage } from '../../../shared/protocol/subagentInspectionProtocol';
import { previewSubagentSnapshot } from './subagentSnapshot';

type Unsequenced<T> = T extends unknown ? Omit<T, 'sequence'> : never;
type PlaybackMessage = Unsequenced<StoreHostMessage>;

/** Local protocol producer. The production reducer owns transcript projection on both sides. */
export function createReplyPlayback(
  fixtures: readonly HostToWebviewMessage[],
  nextSequence: () => number,
  deliver: (message: HostToWebviewMessage) => void,
) {
  const base = fixtures.find((message): message is HostSnapshotMessage => message.type === 'host.snapshot')!;
  let state = initialAssistantWebviewState;
  let generation = 0;
  let inspection: (SubagentInspectMessage & { toolUseId: string }) | null = null;
  const timers = new Set<number>();
  const activities = new Map<string, Extract<HostToWebviewMessage, { type: 'subagent.activity' }>>();
  function emit(event: PlaybackMessage) {
    const message = { ...event, sequence: nextSequence() } as StoreHostMessage;
    state = assistantWebviewReducer(state, { type: 'host.message', message });
    if (message.type === 'subagent.activity') activities.set(`${message.turnId}:${message.toolUseId}`, message);
    deliver(message);
    if (inspection && (message.type === 'tool.activity' || message.type === 'subagent.activity' || message.type === 'turn.state')) {
      publishInspection();
    }
  }
  function publishInspection() {
    if (inspection) emit(previewSubagentSnapshot(inspection, state.transcript,
      activities.get(`${inspection.turnId}:${inspection.toolUseId}`)));
  }
  function cancel() {
    generation++;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  }
  function reset() {
    cancel();
    activities.clear();
    inspection = null;
    state = initialAssistantWebviewState;
    for (const message of fixtures) {
      if (message.type === 'ui.theme') deliver(message);
      else if (message.type === 'canvas.feedbackDraft') deliver({ ...message, sequence: nextSequence() });
      else emit(message.type === 'host.snapshot'
        ? { ...message, conversationId: `${base.conversationId}:preview:${generation}` }
        : message);
    }
  }
  function snapshot() {
    const turn = state.turn && { turnId: state.turn.turnId, status: state.turn.status };
    emit({ ...base, conversationId: state.conversationId, turn,
      transcript: state.transcript, interactions: state.interactions, queue: state.queue });
  }
  function queueState(rejected?: Extract<StoreHostMessage, { type: 'queue.state' }>['rejected']) {
    emit({ type: 'queue.state', sessionId: base.sessionId!, ...state.queue, ...(rejected ? { rejected } : {}) });
  }
  function dispatchNext() {
    if (isTurnActive(state.turn) || state.interactions.length || state.queue.paused) return;
    const next = state.queue.items[0];
    if (!next) return;
    state = assistantWebviewReducer(state, { type: 'queue.remove', queueId: next.queueId });
    queueState();
    start(next.queueId, next.text);
  }
  function play(turnId: string) {
    cancel();
    const epoch = generation;
    for (const step of replyTimeline(base.sessionId!, turnId)) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (epoch !== generation) return;
        emit(step.event);
        if (step.event.type === 'turn.state') dispatchNext();
      }, step.at);
      timers.add(timer);
    }
  }
  function start(turnId: string, text: string) {
    state = assistantWebviewReducer(state, { type: 'turn.send', turnId, text });
    // Queue dispatch has no optimistic user row in the UI: acknowledge the whole new turn.
    snapshot();
    emit({ type: 'turn.state', sessionId: base.sessionId!, turnId, status: 'streaming' });
    play(turnId);
  }
  function stop() {
    cancel();
    if (isTurnActive(state.turn) && state.turn) {
      emit({ type: 'turn.state', sessionId: base.sessionId!, turnId: state.turn.turnId, status: 'interrupted' });
    }
    state = { ...state, queue: { ...state.queue, paused: state.queue.items.length ? 'stopped' : null } };
    queueState();
  }
  function handle(value: unknown): boolean {
    const request = parseWebviewMessage(value);
    if (!request || !('sessionId' in request) || request.sessionId !== base.sessionId) return false;
    switch (request.type) {
      case 'turn.send':
        if (isTurnActive(state.turn) || state.interactions.length) {
          emit({ type: 'turn.error', sessionId: request.sessionId, turnId: request.turnId,
            code: TURN_SEND_REJECTED_CODE, message: 'Stop the current simulation before sending another turn.', retryable: false });
        } else start(request.turnId, request.text);
        return true;
      case 'turn.stop':
        if (state.turn?.turnId === request.turnId) stop();
        return true;
      case 'queue.add':
      case 'queue.update':
      case 'queue.remove':
      case 'queue.clear':
      case 'queue.resume':
      case 'queue.promote': {
        if (request.type === 'queue.add' && (state.queue.items.length >= MAX_QUEUED_MESSAGES
          || state.queue.items.some(item => item.queueId === request.queueId))) {
          queueState({ queueId: request.queueId, text: request.text, reason: 'The simulation queue is full or already contains this message.' });
          return true;
        }
        if (request.type === 'queue.promote' && !state.queue.items.some(item => item.queueId === request.queueId)) return true;
        if (request.type === 'queue.promote') stop();
        state = assistantWebviewReducer(state, request);
        queueState();
        dispatchNext();
        return true;
      }
      case 'permission.respond':
      case 'ask-user.respond': {
        const pending = state.interactions.find(item => item.turnId === request.turnId && item.request.requestId === request.requestId);
        if (!pending || state.turn?.turnId !== request.turnId) return true;
        if (request.type === 'permission.respond' && pending.request.kind === 'permission') {
          if (!pending.request.options.some(option => option.value === request.selectedOption)) return true;
          emit({ type: 'interaction.closed', sessionId: request.sessionId, turnId: request.turnId, requestId: request.requestId });
          if (request.selectedOption === 'deny') { stop(); return true; }
        } else if (request.type === 'ask-user.respond' && pending.request.kind === 'ask-user') {
          const questions = pending.request.questions;
          emit({ type: 'interaction.closed', sessionId: request.sessionId, turnId: request.turnId, requestId: request.requestId,
            result: request.cancelled ? { status: 'cancelled' } : { status: 'answered', answers: request.answers.map(answer => {
              const question = questions.find(item => item.index === answer.index);
              return { topic: question?.topic ?? 'Example', question: question?.question, answer: answer.answer };
            }) } });
          if (request.cancelled) { stop(); return true; }
        } else return true;
        if (!state.interactions.length) play(request.turnId);
        return true;
      }
      case 'subagent.panel':
        if (request.open) for (const activity of activities.values()) emit(activity);
        return true;
      case 'subagent.inspect':
        inspection = request.toolUseId === null ? null : { ...request, toolUseId: request.toolUseId };
        publishInspection();
        return true;
      default:
        return false;
    }
  }
  return { reset, cancel, handle };
}
