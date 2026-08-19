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
    action: 'Read',
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
      window.dispatchEvent(
        new MessageEvent('message', { data: activity() }),
      );
    });

    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();
    expect(result.current.activityStore.get('task-1')).toEqual({
      action: 'Read',
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
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(1) }),
      );
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(2) }),
      );
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
});
