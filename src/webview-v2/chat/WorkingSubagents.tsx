import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { SubagentActivityStoreContext, type useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import { ToolActionsContext } from '../content/toolActions';
import { SubagentRow } from './SubagentRow';
import type { AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import type { ChatPort } from '../host/chatIntent';
import { AgentNavigation, AgentSection } from './AgentNavigation';

export function WorkingSubagents({ working, flow, navigation, port }: {
  readonly working: readonly ToolTranscriptItem[];
  readonly flow: ReturnType<typeof useSubagentPanelFlow>;
  readonly navigation?: AgentChatNavigationMessage | null;
  readonly port?: ChatPort;
}) {
  if (navigation && port) return <AgentNavigation navigation={navigation} port={port} />;
  if (working.length === 0) return null;
  return <AgentSection count={working.length} running={working.length}>
      <SubagentActivityStoreContext.Provider value={flow.activityStore}>
        <ToolActionsContext.Provider value={{ openSubagent: flow.openSubagent }}>
          {working.map((item) => <li key={item.toolUseId}><SubagentRow item={item} variant="row" /></li>)}
        </ToolActionsContext.Provider>
      </SubagentActivityStoreContext.Provider>
  </AgentSection>;
}
