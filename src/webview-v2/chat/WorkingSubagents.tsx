import { useEffect, useMemo, useRef } from 'react';
import type { AssistantWebviewState } from '../state/types';
import { selectWorkingSubagents } from './subagents/subagentWorking';
import { SubagentActivityStoreContext, type useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import { ToolActionsContext } from '../content/toolActions';
import { SubagentRow } from './SubagentRow';
import type { AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import type { ChatPort } from '../host/chatIntent';
import { AgentNavigation, AgentSection } from './AgentNavigation';

export function WorkingSubagents({ state, flow, navigation, port }: {
  readonly state: Pick<AssistantWebviewState, 'sessionId' | 'turn' | 'transcript'>;
  readonly flow: ReturnType<typeof useSubagentPanelFlow>;
  readonly navigation?: AgentChatNavigationMessage | null;
  readonly port?: ChatPort;
}) {
  const live = useRef({ sessionId: state.sessionId, turns: new Set<string>() });
  if (live.current.sessionId !== state.sessionId) live.current = { sessionId: state.sessionId, turns: new Set() };
  const turnId = state.turn?.turnId;
  if (turnId) live.current.turns.add(turnId);
  const working = useMemo(() => selectWorkingSubagents(state.transcript, live.current.turns), [state.transcript, state.sessionId, turnId]);
  const present = working.length > 0;
  useEffect(() => {
    flow.onPanelToggle(present);
    return () => flow.onPanelToggle(false);
  }, [flow.onPanelToggle, present]);
  if (navigation && port) return <AgentNavigation navigation={navigation} port={port} />;
  if (!present) return null;
  const ids = new Set(working.map((item) => item.toolUseId));
  return <AgentSection count={working.length} running={working.length}>
      <SubagentActivityStoreContext.Provider value={flow.activityStore}>
        <ToolActionsContext.Provider value={{ openSubagent: flow.openSubagent }}>
          {state.transcript.flatMap((item) => item.kind === 'tool' && ids.has(item.toolUseId) ? [<li key={item.toolUseId}><SubagentRow item={item} variant="row" /></li>] : [])}
        </ToolActionsContext.Provider>
      </SubagentActivityStoreContext.Provider>
  </AgentSection>;
}
