// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { ToolActionsContext } from '../content/toolActions';
import { SubagentRow } from './SubagentRow';

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
  fireEvent.click(screen.getByRole('button', { name: /scout subagent/ }));
  expect(openSubagent).toHaveBeenCalledExactlyOnceWith('turn-1', 'task-1');

  rendered.rerender(view({ ...running, status: 'completed', subagent: { ...running.subagent, status: 'completed', durationMs: 180_000 } }));
  const settled = screen.getByRole('button', { name: /scout subagent/ }).textContent;
  expect(settled).toContain('Completed');
  expect(settled).toContain('Elapsed 3m');
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole('button', { name: /scout subagent/ }).textContent).toBe(settled);
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
