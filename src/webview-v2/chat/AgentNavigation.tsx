import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Users } from 'lucide-react';
import { AGENT_CHAT_PROTOCOL_VERSION, type AgentChatNavigationMessage, type AgentChatStatus } from '../../shared/protocol/agentChatProtocol';
import { subscribeHostMessages } from '../host/hostMessageSource';
import type { ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';

const STATUS_LABELS: Record<AgentChatStatus, string> = {
  running: 'Running', paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', unknown: 'Status unavailable',
};

export function useAgentChatNavigation(): AgentChatNavigationMessage | null {
  const [navigation, setNavigation] = useState<AgentChatNavigationMessage | null>(null);
  useEffect(() => subscribeHostMessages((message) => {
    if (message.type === 'agent.chat.navigation') setNavigation(message);
  }), []);
  return navigation;
}

export function AgentChatHeading({ navigation, port }: {
  readonly navigation: AgentChatNavigationMessage;
  readonly port: ChatPort;
}) {
  const current = navigation.agents.find((agent) => agent.key === navigation.currentKey);
  if (!current || navigation.parentSessionId === null) return null;
  const parentSessionId = navigation.parentSessionId;
  return <>
    <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Back to main chat" title="Back to main chat"
      onClick={() => port.postMessage({ type: 'agent.chat.back', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId })}>
      <ArrowLeft className="size-4" aria-hidden="true" />
    </Button>
    <span className="min-w-0 truncate text-xs font-medium" title={`${current.role} · ${current.title}`}>{current.title}</span>
  </>;
}

export function AgentNavigation({ navigation, port }: {
  readonly navigation: AgentChatNavigationMessage;
  readonly port: ChatPort;
}) {
  if (navigation.parentSessionId === null || navigation.agents.length === 0) return null;
  const parentSessionId = navigation.parentSessionId;
  const running = navigation.agents.filter((agent) => agent.status === 'running').length;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" aria-label={`Agent conversations: ${navigation.agents.length} total, ${running} running`} title={`${running} running · ${navigation.agents.length} total`}>
        <Users className="size-3.5" aria-hidden="true" /><span>Agents · {navigation.agents.length}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-[300px]">
      <p className="px-2 py-1.5 text-xs text-muted-foreground">{running} running · {navigation.agents.length} total</p>
      {navigation.currentKey !== null ? <DropdownMenuItem onSelect={() => port.postMessage({ type: 'agent.chat.back', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId })}>
        <ArrowLeft className="size-3.5" aria-hidden="true" />Main chat
      </DropdownMenuItem> : null}
      {navigation.agents.map((agent) => <DropdownMenuItem key={agent.key} aria-current={agent.key === navigation.currentKey ? 'page' : undefined}
        className="items-start gap-2" title={agent.title}
        onSelect={() => { if (agent.key !== navigation.currentKey) port.postMessage({ type: 'agent.chat.open', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId, key: agent.key }); }}>
        <span className="mt-0.5 size-3.5 shrink-0">{agent.key === navigation.currentKey ? <Check className="size-3.5" aria-hidden="true" /> : null}</span>
        <span className="min-w-0 flex-1"><span className="block truncate">{agent.title}</span>
          <span className="mt-0.5 flex justify-between gap-2 text-[11px] text-muted-foreground"><span className="truncate">{agent.role}</span><span className="shrink-0">{STATUS_LABELS[agent.status]}</span></span>
        </span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
