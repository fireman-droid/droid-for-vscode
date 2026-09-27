import type { HostToWebviewMessage } from '../bridgeMessages';

/** State replayed by the chat controller. One-shot actions are never retried. */
export const REPLAYABLE_CHAT_STATE = new Set<HostToWebviewMessage['type']>([
  'host.snapshot', 'host.connection', 'host.ide',
  'assistant.delta', 'thinking.delta', 'thinking.complete', 'tool.activity',
  'subagent.update', 'transcript.image', 'runtime.diagnostic',
  'turn.state', 'turn.error', 'user.message-meta',
  'interaction.request', 'interaction.closed', 'plan.document.state',
  'session.settings', 'session.context', 'session.tokenUsage', 'session.model-catalog',
  'session.running', 'changes.update', 'queue.state',
]);
