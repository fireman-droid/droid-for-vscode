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
  it('preserves sheet and item identities for unchanged polling snapshots', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage }, 'session-1'),
    );
    act(() => {
      result.current.actions.onOpenTranscript('task-1', 'Explore');
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'subagent.transcript',
            sequence: 1,
            sessionId: 'session-1',
            toolUseId: 'task-1',
            status: 'available',
            title: 'Explore',
            items: [
              { id: 'user-1', kind: 'user', text: 'Inspect src' },
              {
                id: 'assistant-1',
                kind: 'assistant',
                turnId: 'turn-1',
                text: 'Done',
              },
            ],
            truncated: false,
          },
        }),
      );
    });
    const firstSheet = result.current.sheet;
    expect(firstSheet?.status).toBe('available');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'subagent.transcript',
            sequence: 2,
            sessionId: 'session-1',
            toolUseId: 'task-1',
            status: 'available',
            title: 'Explore',
            items: [
              { id: 'user-1', kind: 'user', text: 'Inspect src' },
              {
                id: 'assistant-1',
                kind: 'assistant',
                turnId: 'turn-1',
                text: 'Done',
              },
            ],
            truncated: false,
          },
        }),
      );
    });
    expect(result.current.sheet).toBe(firstSheet);
  });

  it('updates a growing message in place while retaining unchanged identities', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage }, 'session-1'),
    );
    const snapshot = (sequence: number, text: string, includeTool: boolean) => ({
      type: 'subagent.transcript',
      sequence,
      sessionId: 'session-1',
      toolUseId: 'task-1',
      status: 'available',
      title: 'Explore',
      items: [
        { id: 'user-1', kind: 'user', text: 'Inspect src' },
        {
          id: 'assistant-1',
          kind: 'assistant',
          turnId: 'turn-1',
          text,
        },
        ...(includeTool
          ? [
              {
                id: 'tool-1',
                kind: 'tool',
                turnId: 'turn-1',
                toolUseId: 'call-1',
                toolName: 'Read',
                action: 'Read workspace files',
                status: 'running',
                progressCount: 0,
                latestUpdateKind: null,
              },
            ]
          : []),
      ],
      truncated: false,
    });

    act(() => {
      result.current.actions.onOpenTranscript('task-1', 'Explore');
      window.dispatchEvent(
        new MessageEvent('message', {
          data: snapshot(1, 'Reading', false),
        }),
      );
    });
    const firstItems = result.current.sheet!.items;

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: snapshot(2, 'Reading files', true),
        }),
      );
    });
    const nextItems = result.current.sheet!.items;
    expect(nextItems).toHaveLength(3);
    expect(nextItems[0]).toBe(firstItems[0]);
    expect(nextItems[1]).not.toBe(firstItems[1]);
    expect(nextItems[1]).toMatchObject({ text: 'Reading files' });
    expect(result.current.sheet?.status).toBe('available');
  });

  it('ignores stoppable-only updates and exposes no stop action', () => {
    const postMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubagentPanelFlow({ postMessage }, 'session-1'),
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(true) }),
      );
    });
    expect(result.current.activities.get('task-1')?.action).toBe('Read');
    const firstActivities = result.current.activities;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: activity(false, 2) }),
      );
    });
    expect(result.current.activities).toBe(firstActivities);
    expect('onStop' in result.current.actions).toBe(false);
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.type === 'subagent.stop',
      ),
    ).toHaveLength(0);
  });
});
