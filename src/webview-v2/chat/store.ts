import { createStore } from 'zustand/vanilla';
import { assistantWebviewReducer } from '../state/store';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewAction, AssistantWebviewState } from '../state/types';

export function selectCurrentTurnChanges(state: AssistantWebviewState) {
  const turnId = state.turn?.turnId ?? [...state.transcript].reverse().find((item) => item.kind !== 'user')?.turnId;
  return state.transcript.find((item) => item.kind === 'changes' && item.turnId === turnId);
}

export interface ChatState {
  readonly state: AssistantWebviewState;
  readonly dispatch: (action: AssistantWebviewAction) => void;
}

/** Each mounted panel owns its store; domain transitions remain in the shared reducer. */
export function createChatStore(initialState = initialAssistantWebviewState) {
  return createStore<ChatState>()((set) => ({
    state: initialState,
    dispatch: (action) => set((current) => {
      const state = assistantWebviewReducer(current.state, action);
      return state === current.state ? current : { state };
    }),
  }));
}

export type ChatStore = ReturnType<typeof createChatStore>;

export function selectChatShell({ state }: ChatState) {
  const { sequence, transcript, turn, ...controls } = state;
  let activeTools = 0;
  let subagentTools = 0;
  if (turn && (turn.status === 'submitting' || turn.status === 'streaming')) {
    for (const item of transcript) {
      if (item.kind === 'tool' && item.status === 'running' && item.turnId === turn.turnId) {
        activeTools += 1;
        if (item.subagent !== undefined && (item.subagent.status === undefined || item.subagent.status === 'running' || item.subagent.status === 'pending')) {
          subagentTools += 1;
        }
      }
    }
  }
  return { ...controls, transcriptLength: transcript.length, received: sequence >= 0,
    currentChanges: selectCurrentTurnChanges(state),
    turnId: turn?.turnId, turnStatus: turn?.status, turnActivity: turn?.activity, turnCompacting: turn?.compacting,
    activeTools, waitingForSubagents: activeTools > 0 && activeTools === subagentTools };
}
