import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, Users } from 'lucide-react';
import { AGENT_CHAT_PROTOCOL_VERSION, type AgentChatNavigationMessage, type AgentChatStatus } from '../../shared/protocol/agentChatProtocol';
import { subscribeHostMessages } from '../host/hostMessageSource';
import type { ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import type { ReactNode } from 'react';

const STATUS_LABELS: Record<AgentChatStatus, string> = {
  running: 'Running', paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped', unknown: 'Status unavailable',
};

export function useAgentChatNavigation(sessionId: string | null): AgentChatNavigationMessage | null {
  const [navigation, setNavigation] = useState<AgentChatNavigationMessage | null>(null);
  const snapshotSequence = useRef(-1);
  useEffect(() => subscribeHostMessages((message) => {
    if (message.type === 'agent.chat.navigation') setNavigation(message);
    else if (message.type === 'host.snapshot' && message.sequence > snapshotSequence.current) {
      snapshotSequence.current = message.sequence;
      setNavigation((current) => current?.currentKey != null ||
        current?.parentSessionId === message.sessionId ? current : null);
    }
  }), []);
  return navigation?.currentKey != null || navigation?.parentSessionId === sessionId ? navigation : null;
}

export function AgentSection({ count, running, children }: {
  readonly count: number;
  readonly running: number;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
    <section className="v2-composer-changes" aria-label="Agent conversations">
      <div className="v2-composer-changes-header v2-composer-agents-header">
        <CollapsibleTrigger asChild>
          <Button variant="plain" size="none" className="v2-composer-changes-toggle" aria-controls={id}>
            <ChevronRight aria-hidden="true" className={expanded ? 'rotate-90' : undefined} />
            <span>{count} {count === 1 ? 'Agent' : 'Agents'}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">{running} running</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <AnimatedCollapsibleContent id={id} open={expanded}>
        <ul className="v2-composer-changes-list">{children}</ul>
      </AnimatedCollapsibleContent>
    </section>
  </Collapsible>;
}

export function AgentNavigation({ navigation, port }: {
  readonly navigation: AgentChatNavigationMessage;
  readonly port: ChatPort;
}) {
  if (navigation.parentSessionId === null || navigation.agents.length === 0) return null;
  const parentSessionId = navigation.parentSessionId;
  const running = navigation.agents.filter((agent) => agent.status === 'running').length;
  return <AgentSection count={navigation.agents.length} running={running}>
    {navigation.agents.map((agent) => <li key={agent.key} className="flex min-w-0 items-center">
      <Button variant="plain" size="none" className="v2-composer-changes-file min-w-0 flex-1"
        aria-current={agent.key === navigation.currentKey ? 'page' : undefined}
        title={`${agent.title}\n${agent.role} · ${STATUS_LABELS[agent.status]}`}
        onClick={() => { if (agent.key !== navigation.currentKey) port.postMessage({ type: 'agent.chat.open', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId, key: agent.key }); }}>
        {agent.key === navigation.currentKey ? <Check aria-hidden="true" /> : <Users aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{agent.title}</span>
        <span className={`shrink-0 text-[11px] ${agent.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{STATUS_LABELS[agent.status]}</span>
      </Button>
      {agent.canStop || agent.stopPending ? <Button variant="plain" size="none"
        className="v2-composer-changes-stop min-h-7 w-[68px] shrink-0 whitespace-nowrap"
        disabled={agent.stopPending} aria-busy={agent.stopPending}
        aria-label={`${agent.stopPending ? 'Stopping' : 'Stop'} agent task: ${agent.title}`}
        title={`${agent.stopPending ? 'Stopping' : 'Stop'} ${agent.title}`}
        onClick={() => port.postMessage({ type: 'agent.chat.stop', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId, key: agent.key })}>
        {agent.stopPending ? 'Stopping…' : 'Stop'}
      </Button> : null}
    </li>)}
  </AgentSection>;
}
