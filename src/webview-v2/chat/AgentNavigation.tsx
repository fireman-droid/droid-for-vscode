import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, Users } from 'lucide-react';
import { AGENT_CHAT_PROTOCOL_VERSION, type AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { getWebviewPageId, WEBVIEW_BUILD_ID } from '../bridge/vscode';
import type { ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import type { ReactNode } from 'react';
import { presentNavigationAgent } from './subagents/agentPresentation';

export function useAgentChatNavigation(sessionId: string | null, port: ChatPort): AgentChatNavigationMessage | null {
  const [navigation, setNavigation] = useState<AgentChatNavigationMessage | null>(null);
  const snapshotSequence = useRef(-1);
  const activeSession = useRef(sessionId);
  activeSession.current = sessionId;
  const reported = useRef(new Map<string, string>());
  const report = (source: string, scope: Record<string, string | number | null>) => {
    const value = JSON.stringify(scope);
    if (reported.current.get(source) === value) return;
    reported.current.set(source, value);
    port.postMessage({ type: 'webview.diagnostic', kind: 'perf-batch', detail: JSON.stringify({
      source, pageId: getWebviewPageId(port), build: WEBVIEW_BUILD_ID, ...scope,
    }) });
  };
  useEffect(() => subscribeHostMessages((message) => {
    if (message.type === 'agent.chat.navigation') {
      report('agents.navigation.received', { sessionId: activeSession.current,
        parentSessionId: message.parentSessionId, currentKey: message.currentKey, agents: message.agents.length });
      setNavigation(message);
    }
    else if (message.type === 'host.snapshot' && message.sequence > snapshotSequence.current) {
      snapshotSequence.current = message.sequence;
      setNavigation((current) => current?.currentKey != null ||
        current?.parentSessionId === message.sessionId ? current : null);
    }
  }), [port]);
  const visible = navigation?.currentKey != null || navigation?.parentSessionId === sessionId ? navigation : null;
  useEffect(() => {
    // Correlate received navigation with the committed session projection, without task contents.
    report('agents.navigation.projected', { sessionId, parentSessionId: navigation?.parentSessionId ?? null,
      currentKey: navigation?.currentKey ?? null, agents: navigation?.agents.length ?? 0,
      visibleAgents: visible?.agents.length ?? 0 });
  }, [port, sessionId, navigation, visible]);
  return visible;
}

export function AgentSection({ count, running, children }: {
  readonly count: number;
  readonly running: number;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
    <section className="v2-composer-changes v2-composer-agents" aria-label="Agents">
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
    {navigation.agents.map((agent) => {
      const row = presentNavigationAgent(agent, navigation.currentKey, {
        open: () => port.postMessage({ type: 'agent.chat.open', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId, key: agent.key }),
        stop: () => port.postMessage({ type: 'agent.chat.stop', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId, key: agent.key }),
      });
      return <li key={agent.key} className="flex min-w-0 items-center">
        <Button variant="plain" size="none" className="v2-composer-changes-file min-w-0 flex-1"
          aria-current={row.selected ? 'page' : undefined}
          title={`${row.title}\n${row.role} · ${row.statusLabel}`}
          onClick={row.onOpen}>
          {row.selected ? <Check aria-hidden="true" /> : <Users aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          <span className={`shrink-0 text-[11px] ${row.tone === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{row.statusLabel}</span>
        </Button>
        {row.onStop ? <Button variant="plain" size="none"
          className="v2-composer-changes-stop min-h-6 w-[68px] shrink-0 whitespace-nowrap"
          disabled={row.stopPending} aria-busy={row.stopPending || undefined}
          aria-label={`${row.stopPending ? 'Stopping' : 'Stop'} agent task: ${row.title}`}
          title={`${row.stopPending ? 'Stopping' : 'Stop'} ${row.title}`}
          onClick={row.onStop}>
          {row.stopPending ? 'Stopping…' : 'Stop'}
        </Button> : null}
      </li>;
    })}
  </AgentSection>;
}
