import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const AGENT_CHAT_PROTOCOL_VERSION = 1 as const;
export const MAX_AGENT_CHAT_SESSIONS = 256;
export type AgentChatStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'unknown';

export interface AgentChatEntry {
  readonly key: string;
  readonly title: string;
  readonly role: string;
  readonly status: AgentChatStatus;
  readonly canStop?: true;
  readonly stopPending?: true;
}

/** Navigation is scoped to one parent; child session identities stay Host-owned. */
export interface AgentChatNavigationMessage {
  readonly type: 'agent.chat.navigation';
  readonly protocolVersion: typeof AGENT_CHAT_PROTOCOL_VERSION;
  readonly parentSessionId: string | null;
  readonly currentKey: string | null;
  readonly agents: readonly AgentChatEntry[];
}

export type AgentChatCommand = {
  readonly type: 'agent.chat.open' | 'agent.chat.stop';
  readonly protocolVersion: typeof AGENT_CHAT_PROTOCOL_VERSION;
  readonly parentSessionId: string;
  readonly key: string;
} | {
  readonly type: 'agent.chat.back';
  readonly protocolVersion: typeof AGENT_CHAT_PROTOCOL_VERSION;
  readonly parentSessionId: string;
};

const text = (value: unknown, limit: number): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= limit && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

export function parseAgentChatCommand(value: unknown): AgentChatCommand | null {
  if (!isStrictRecord(value) || value.protocolVersion !== AGENT_CHAT_PROTOCOL_VERSION ||
    !text(value.parentSessionId, 256)) return null;
  if (value.type === 'agent.chat.back' && hasExactKeys(value, ['type', 'protocolVersion', 'parentSessionId']))
    return { type: value.type, protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId: value.parentSessionId };
  if ((value.type === 'agent.chat.open' || value.type === 'agent.chat.stop') && text(value.key, 512) &&
    hasExactKeys(value, ['type', 'protocolVersion', 'parentSessionId', 'key']))
    return { type: value.type, protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId: value.parentSessionId, key: value.key };
  return null;
}

export function parseAgentChatNavigation(value: unknown): AgentChatNavigationMessage | null {
  if (!isStrictRecord(value) || value.type !== 'agent.chat.navigation' ||
    value.protocolVersion !== AGENT_CHAT_PROTOCOL_VERSION ||
    !hasExactKeys(value, ['type', 'protocolVersion', 'parentSessionId', 'currentKey', 'agents']) ||
    value.parentSessionId !== null && !text(value.parentSessionId, 256) ||
    value.currentKey !== null && !text(value.currentKey, 512) ||
    !Array.isArray(value.agents) || value.agents.length > MAX_AGENT_CHAT_SESSIONS) return null;
  const agents: AgentChatEntry[] = [];
  const keys = new Set<string>();
  for (const entry of value.agents) {
    if (!isStrictRecord(entry) || !hasExactKeys(entry, ['key', 'title', 'role', 'status'], ['canStop', 'stopPending']) ||
      !text(entry.key, 512) || !text(entry.title, 256) || !text(entry.role, 80) ||
      entry.canStop !== undefined && entry.canStop !== true ||
      entry.stopPending !== undefined && entry.stopPending !== true ||
      typeof entry.status !== 'string' ||
      !['running', 'paused', 'completed', 'failed', 'cancelled', 'unknown'].includes(entry.status) || keys.has(entry.key)) return null;
    keys.add(entry.key);
    agents.push({ key: entry.key, title: entry.title, role: entry.role, status: entry.status as AgentChatStatus,
      ...(entry.canStop === true ? { canStop: true } : {}),
      ...(entry.stopPending === true ? { stopPending: true } : {}) });
  }
  if (value.currentKey !== null && !keys.has(value.currentKey) ||
    value.parentSessionId === null && (value.currentKey !== null || agents.length > 0)) return null;
  return { type: value.type, protocolVersion: AGENT_CHAT_PROTOCOL_VERSION,
    parentSessionId: value.parentSessionId, currentKey: value.currentKey, agents };
}
