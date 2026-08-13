// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSubagentPanelFlow } from './subagentPanelFlow';

afterEach(cleanup);

function activity(stoppable: boolean, sequence = 1): unknown {
  return {
    type: 'subagent.activity',
    sequence,
    sessionId: 'session-1',
    turnId: 'turn-1',
    toolUseId: 'task-1',
    action: 'Read',
    stoppable,
  };
}

describe('useSubagentPanelFlow', () => {
  it('suppresses rapid duplicate Stop posts and hides the control', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage }, 'session-1'),
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(true) }),
      );
    });
    expect(result.current.activities.get('task-1')?.stoppable).toBe(true);

    act(() => {
      result.current.actions.onStop('turn-1', 'task-1');
      result.current.actions.onStop('turn-1', 'task-1');
    });
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.type === 'subagent.stop',
      ),
    ).toHaveLength(1);
    expect(result.current.activities.get('task-1')?.stoppable).toBe(false);
  });

  it('allows one retry only after the Host responds', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage }, 'session-1'),
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(true) }),
      );
      result.current.actions.onStop('turn-1', 'task-1');
    });
    act(() => {
      // A pre-click sample that arrives late must not resurrect Stop.
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(true, 2) }),
      );
    });
    expect(result.current.activities.get('task-1')?.stoppable).toBe(false);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(false, 3) }),
      );
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(true, 4) }),
      );
      result.current.actions.onStop('turn-1', 'task-1');
    });
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.type === 'subagent.stop',
      ),
    ).toHaveLength(2);
  });
});
