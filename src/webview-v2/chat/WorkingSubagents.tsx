import { useEffect, useMemo, useRef } from 'react';
import type { AssistantWebviewState } from '../state/types';
import { selectWorkingSubagents } from './subagents/subagentWorking';
import { SubagentActivityStoreContext, type useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import { ToolActionsContext } from '../content/toolActions';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { Button } from '../ui/button';
import { SubagentRow } from './SubagentRow';
import type { AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import type { ChatPort } from '../host/chatIntent';
import { AgentNavigation } from './AgentNavigation';

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
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="sm">{working.length} Working</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[280px] divide-y divide-[var(--panel-edge)] p-1">
      <SubagentActivityStoreContext.Provider value={flow.activityStore}>
        <ToolActionsContext.Provider value={{ openSubagent: flow.openSubagent }}>
          {state.transcript.flatMap((item) => item.kind === 'tool' && ids.has(item.toolUseId) ? [<SubagentRow key={item.toolUseId} item={item} variant="row" />] : [])}
        </ToolActionsContext.Provider>
      </SubagentActivityStoreContext.Provider>
    </PopoverContent>
  </Popover>;
}
