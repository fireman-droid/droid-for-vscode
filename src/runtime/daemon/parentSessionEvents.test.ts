import { describe, expect, it } from 'vitest';
import { createSubagentEventSource, type SubagentEvent } from './daemonNotificationSource';
import { ParentSessionEvents, type ParentSessionEvent } from './parentSessionEvents';

const message = (id: string, role: string, content: unknown[]) => ({ id, role, content, createdAt: 1, updatedAt: 1 });
const automatic = (id: string) => ({ type: 'create_message', requestId: id,
  message: { ...message(id, 'system', [{ type: 'text', text: 'Background task completed.' }]), visibility: 'llm_only' } });
const complete = (turnId: string, reason = 'completed') => ({ type: 'agent_turn_completed', turnId, reason,
  tokenUsage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0 } });

describe('passive parent session notifications', () => {
  it('observes only the foreground boundary without projecting its text or tools a second time', () => {
    const events: ParentSessionEvent[] = [];
    const parent = new ParentSessionEvents('parent', 'C:/workspace', event => events.push(event));
    parent.observe({ type: 'create_message', message: message('foreground', 'user', [{ type: 'text', text: 'Inspect code' }]) });
    parent.observe({ type: 'assistant_text_delta', messageId: 'answer', blockIndex: 0, textDelta: 'Foreground answer' });
    parent.observe({ type: 'tool_call', toolUse: { id: 'read', name: 'Read', input: { file_path: 'src/events.ts' } } });
    parent.observe(complete('foreground'));
    expect(events).toEqual([{ type: 'turn-start', turnId: 'foreground', automatic: false }]);
  });

  it('uses the real asynchronous system request id and ignores its empty context row', () => {
    const events: ParentSessionEvent[] = [];
    const parent = new ParentSessionEvents('parent', 'C:/workspace', event => events.push(event));
    parent.observe({ type: 'create_message', message: message('context-task-completion:1', 'user', []) });
    expect(events).toEqual([]);
    parent.observe(automatic('task-completion:1'));
    parent.observe({ type: 'assistant_text_delta', messageId: 'answer', blockIndex: 0, textDelta: 'Collected results' });
    parent.observe(complete('old-submission'));
    expect(events.at(-1)).toMatchObject({ type: 'runtime', turnId: 'task-completion:1', event: { type: 'text-delta', text: 'Collected results' } });
    parent.observe(complete('task-completion:1'));
    expect(events.at(-1)).toMatchObject({ type: 'runtime', turnId: 'task-completion:1', event: { type: 'turn-complete', outcome: 'success' } });
    expect(events.filter(event => event.type === 'turn-start')).toEqual([{ type: 'turn-start', turnId: 'task-completion:1', automatic: true }]);
    expect(events.some(event => event.type === 'runtime' && event.event.type === 'user-message')).toBe(false);
  });

  it('keeps Script completion context inside its foreground owner and accepts the next real follow-up', () => {
    const events: ParentSessionEvent[] = [];
    const parent = new ParentSessionEvents('parent', 'C:/workspace', event => events.push(event));
    parent.observe({ type: 'create_message', message: message('foreground', 'user', [{ type: 'text', text: 'Implement the entity' }]) });
    parent.observe({ type: 'create_message', message: { ...message('script-completion:1', 'user', [{ type: 'text', text: 'Script finished' }]), visibility: 'llm_only' } });
    parent.observe(automatic('script-completion:1'));
    parent.observe({ type: 'assistant_text_delta', messageId: 'answer', blockIndex: 0, textDelta: 'Entity implemented' });
    parent.observe(complete('script-completion:1'));
    parent.observe({ type: 'create_message', message: message('steering', 'user', [{ type: 'text', text: 'Include tests' }]) });
    parent.observe(complete('steering'));
    parent.observe(automatic('script-completion:2'));
    expect(events).toEqual([{ type: 'turn-start', turnId: 'foreground', automatic: false }]);
    parent.observe(complete('foreground'));
    parent.observe(complete('script-completion:2'));
    parent.observe(automatic('task-completion:next'));
    parent.observe({ type: 'assistant_text_delta', messageId: 'follow-up', blockIndex: 0, textDelta: 'Background results arrived' });
    parent.observe(complete('task-completion:next'));
    expect(events.filter(event => event.type === 'turn-start')).toEqual([
      { type: 'turn-start', turnId: 'foreground', automatic: false },
      { type: 'turn-start', turnId: 'task-completion:next', automatic: true },
    ]);
    expect(events.filter(event => event.type === 'runtime' && event.event.type === 'text-delta')).toEqual([
      { type: 'runtime', turnId: 'task-completion:next', event: { type: 'text-delta', text: 'Background results arrived' } },
    ]);
    expect(events.at(-1)).toMatchObject({ turnId: 'task-completion:next', event: { type: 'turn-complete', outcome: 'success' } });
  });

  it('does not treat hidden user context or ordinary system messages as a new foreground or automatic turn', () => {
    const events: ParentSessionEvent[] = [];
    const parent = new ParentSessionEvents('parent', 'C:/workspace', event => events.push(event));
    parent.observe({ type: 'create_message', message: { ...message('script-context', 'user', [{ type: 'text', text: 'Script finished' }]), visibility: 'llm_only' } });
    parent.observe({ type: 'create_message', requestId: 'settings', message: message('settings', 'system', [{ type: 'text', text: 'Settings changed' }]) });
    expect(events).toEqual([]);
    parent.observe(automatic('follow-up'));
    expect(events).toEqual([{ type: 'turn-start', turnId: 'follow-up', automatic: true }]);
  });

  it('keeps cancellation and transport resync scoped to the matching automatic turn', () => {
    const events: ParentSessionEvent[] = [];
    const parent = new ParentSessionEvents('parent', 'C:/workspace', event => events.push(event));
    parent.observe(automatic('task-completion:1'));
    parent.resync();
    parent.observe(complete('task-completion:1', 'cancelled'));
    parent.observe(automatic('task-completion:2'));
    parent.observe(complete('task-completion:1'));
    expect(events.filter(event => event.type === 'runtime' && event.event.type === 'turn-complete')).toEqual([
      expect.objectContaining({ turnId: 'task-completion:1', event: expect.objectContaining({ outcome: 'interrupted' }) }),
    ]);
    expect(events).toContainEqual({ type: 'resync' });
    expect(events.at(-1)).toEqual({ type: 'turn-start', turnId: 'task-completion:2', automatic: true });
  });

  it('does not let a foreground boundary lost during reconnect suppress later background turns', () => {
    const events: ParentSessionEvent[] = [];
    const parent = new ParentSessionEvents('parent', 'C:/workspace', event => events.push(event));
    parent.observe({ type: 'create_message', message: message('foreground', 'user', [{ type: 'text', text: 'Delegate' }]) });
    parent.resync();
    parent.observe(automatic('after-reconnect'));
    parent.observe(complete('after-reconnect'));
    expect(events.at(-1)).toMatchObject({ turnId: 'after-reconnect', event: { type: 'turn-complete', outcome: 'success' } });
  });

  it('pairs child tool-result content with the earlier input and emits one named preview', () => {
    const source = createSubagentEventSource();
    const events: SubagentEvent[] = [];
    source.subscribe(event => events.push(event));
    source.watch('child', 'C:/workspace', true);
    const notify = (notification: Record<string, unknown>) => source.observeProcessNotification('child', { params: { sessionId: 'child', notification } });
    notify({ type: 'tool_call', toolUse: { id: 'read-1', name: 'Read', input: {} } });
    notify({ type: 'create_message', message: message('assistant', 'assistant', [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'C:/workspace/src/events.ts' } }]) });
    notify({ type: 'tool_result', toolUseId: 'read-1', messageId: 'tool-result-1', content: 'export const event = "open";', isError: false });
    const results = events.filter(event => event.type === 'runtime' && event.event.type === 'tool-result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ event: { toolName: 'Read', resultPreview: { availability: 'available', source: { tool: 'Read', path: 'src/events.ts' } } } });
    source.dispose();
  });
});
