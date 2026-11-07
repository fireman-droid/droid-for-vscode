// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSubagentPanelFlow } from './subagentPanelFlow';

afterEach(cleanup);

function activity(sequence = 1, toolUseId = 'task-1'): unknown {
  return {
    type: 'subagent.activity',
    sequence,
    sessionId: 'session-1',
    turnId: 'turn-1',
    toolUseId,
    activities: [
      { action: 'Read workspace files', target: 'src/app.ts' },
      { action: 'Searched workspace content', target: 'src' },
    ],
  };
}

describe('useSubagentPanelFlow', () => {
  it('publishes activity only to the keyed inline Task card', () => {
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage: vi.fn() }, 'session-1'),
    );
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = result.current.activityStore.subscribe(
      'task-1',
      firstListener,
    );
    const unsubscribeSecond = result.current.activityStore.subscribe(
      'task-2',
      secondListener,
    );

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: activity() }));
    });

    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();
    expect(result.current.activityStore.get('task-1')).toEqual({
      activities: [
        { action: 'Read workspace files', target: 'src/app.ts' },
        { action: 'Searched workspace content', target: 'src' },
      ],
    });
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('ignores duplicate activity and messages for another session', () => {
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage: vi.fn() }, 'session-1'),
    );
    const listener = vi.fn();
    result.current.activityStore.subscribe('task-1', listener);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: activity(1) }));
      window.dispatchEvent(new MessageEvent('message', { data: activity(2) }));
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { ...activity(3), sessionId: 'session-2' },
        }),
      );
    });

    expect(listener).toHaveBeenCalledOnce();
  });

  it('exposes only the panel polling toggle', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage }, 'session-1'),
    );
    act(() => result.current.onPanelToggle(true));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'subagent.panel',
      sessionId: 'session-1',
      open: true,
    });
    expect(result.current).not.toHaveProperty('sheet');
    expect(result.current).not.toHaveProperty('actions');
  });

  it('subscribes to inline subagent snapshots, ignores stale sequences or other sessions, and releases with null', () => {
    const postMessage = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessionId }) => useSubagentPanelFlow({ postMessage }, sessionId),
      { initialProps: { sessionId: 'session-1' as string | null } },
    );

    act(() => result.current.inspectSubagent('turn-1', 'task-1'));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'subagent.inspect',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'task-1',
    });
    expect(result.current.inspection).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'task-1',
      snapshot: null,
    });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'subagent.snapshot',
          sequence: 2,
          sessionId: 'session-1',
          turnId: 'turn-1',
          toolUseId: 'task-1',
          status: 'ready',
          title: 'explorer · Check narrow chat states',
          items: [{ kind: 'assistant', id: 'a-1', turnId: 'child-turn-1', text: 'Subagent progress' }],
          truncated: false,
          running: true,
          lifecycle: 'working',
        },
      }));
      // Stale sequence and mismatched session/toolUseId must be ignored
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'subagent.snapshot',
          sequence: 1,
          sessionId: 'session-1',
          turnId: 'turn-1',
          toolUseId: 'task-1',
          status: 'unavailable',
          title: 'Stale',
          items: [],
          truncated: false,
          running: false,
          lifecycle: null,
          reason: 'Stale',
        },
      }));
    });

    expect(result.current.inspection?.snapshot?.status).toBe('ready');
    expect(result.current.inspection?.snapshot?.title).toBe('explorer · Check narrow chat states');

    // Clicking the same subagent again toggles inline inspection closed and sends toolUseId: null
    act(() => result.current.inspectSubagent('turn-1', 'task-1'));
    expect(result.current.inspection).toBeNull();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'subagent.inspect',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: null,
    });

    // Switching parent session also releases active inspection
    act(() => result.current.inspectSubagent('turn-1', 'task-1'));
    rerender({ sessionId: 'session-2' });
    expect(result.current.inspection).toBeNull();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'subagent.inspect',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: null,
    });
  });
});
