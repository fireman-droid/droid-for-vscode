// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { ToolActionsContext } from '../content/toolActions';
import { SubagentRow } from './SubagentRow';
import { AgentNavigation } from './AgentNavigation';
import { AGENT_CHAT_PROTOCOL_VERSION, type AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const task: ToolTranscriptItem = {
  kind: 'tool', id: 'delegation', turnId: 'turn-1', toolUseId: 'task-1', toolName: 'Task',
  action: 'Delegate task', status: 'running', progressCount: 0, latestUpdateKind: null,
  subagent: { type: 'scout', description: 'Inspect the active module', status: 'running' },
};

it('preserves the recorded start across virtual remounts and foreground-to-background transitions', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T08:00:00Z'));
  const startedAt = Date.now() - 160_000;
  const running = { ...task, subagent: { ...task.subagent!, startedAt, durationMs: 150_000 } };
  const openSubagent = vi.fn();
  const view = (item: ToolTranscriptItem | null) => <ToolActionsContext.Provider value={{ openSubagent }}>
    {item ? <SubagentRow item={item} /> : null}
  </ToolActionsContext.Provider>;
  const rendered = render(view(running));
  expect(screen.getByText('Elapsed 2m 40s')).toBeTruthy();
  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.getByText('Elapsed 2m 42s')).toBeTruthy();
  rendered.rerender(view(null));
  act(() => vi.advanceTimersByTime(10_000));
  rendered.rerender(view({ ...running, status: 'completed' }));
  expect(screen.getByText('Elapsed 2m 52s')).toBeTruthy();
  expect(screen.getByText('Running in background')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Inspect the active module/ }));
  expect(openSubagent).toHaveBeenCalledExactlyOnceWith('turn-1', 'task-1');

  rendered.rerender(view({ ...running, status: 'completed', subagent: { ...running.subagent, status: 'completed', durationMs: 180_000 } }));
  const settled = screen.getByRole('button', { name: /Inspect the active module/ }).textContent;
  expect(settled).toContain('Completed');
  expect(settled).toContain('Elapsed 3m');
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole('button', { name: /Inspect the active module/ }).textContent).toBe(settled);
});

it('does not invent elapsed time or a pending lifecycle when history lacks those facts', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T08:00:00Z'));
  const rendered = render(<SubagentRow item={task} />);
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByText('Running')).toBeTruthy();
  expect(screen.queryByText(/Elapsed/)).toBeNull();
  rendered.rerender(<SubagentRow item={{ ...task, status: 'completed', subagent: { type: 'scout', description: task.subagent!.description } }} />);
  expect(screen.queryByText('Pending')).toBeNull();
  expect(screen.queryByText('Running')).toBeNull();
  expect(screen.getByText('Inspect the active module')).toBeTruthy();
  rendered.rerender(<SubagentRow item={{ ...task, subagent: { ...task.subagent!, startedAt: Date.now() - 70_000 } }} />);
  expect(screen.getByText('Elapsed 1m 10s')).toBeTruthy();
});

it('uses the same stopped status for a tool card and its navigation entry', () => {
  const navigation: AgentChatNavigationMessage = {
    type: 'agent.chat.navigation', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION,
    parentSessionId: 'parent-1', currentKey: null,
    agents: [{ key: 'agent-1', title: 'Stopped task', role: 'scout', status: 'cancelled' }],
  };
  const port = { postMessage: vi.fn() };
  render(<>
    <SubagentRow item={{ ...task, subagent: { ...task.subagent!, status: 'cancelled' } }} />
    <AgentNavigation navigation={navigation} port={port} />
  </>);
  fireEvent.click(screen.getByRole('button', { name: /1 Agent/ }));
  expect(screen.getAllByText('Stopped')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Stop agent task/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Stopped task/ }));
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'agent.chat.open', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId: 'parent-1', key: 'agent-1',
  });
});

it('stops only a Host-authorized navigation entry and keeps pending stop requests disabled', () => {
  const navigation: AgentChatNavigationMessage = {
    type: 'agent.chat.navigation', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION,
    parentSessionId: 'parent-1', currentKey: null,
    agents: [{ key: 'agent-1', title: 'Active task', role: 'worker', status: 'running', canStop: true }],
  };
  const port = { postMessage: vi.fn() };
  const rendered = render(<AgentNavigation navigation={navigation} port={port} />);
  fireEvent.click(screen.getByRole('button', { name: /1 Agent/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop agent task: Active task' }));
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'agent.chat.stop', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION, parentSessionId: 'parent-1', key: 'agent-1',
  });
  rendered.rerender(<AgentNavigation navigation={{ ...navigation,
    agents: [{ key: 'agent-1', title: 'Active task', role: 'worker', status: 'running', stopPending: true }],
  }} port={port} />);
  const pending = screen.getByRole('button', { name: 'Stopping agent task: Active task' });
  expect(pending.hasAttribute('disabled')).toBe(true);
  fireEvent.click(pending);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
});
