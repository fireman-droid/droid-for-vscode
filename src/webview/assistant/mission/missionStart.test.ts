import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import {
  MISSION_START_TIMEOUT_MS,
  postMissionStartTracked,
  type PendingMissionStart,
} from './missionStart';

afterEach(() => {
  vi.useRealTimers();
});

describe('Mission start tracking', () => {
  it('releases the single-flight gate after a bounded missing result', () => {
    vi.useFakeTimers();
    const posted: WebviewToHostMessage[] = [];
    const requests = new Map<string, PendingMissionStart>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const timedOut = vi.fn();
    let nextId = 0;
    const start = () =>
      postMissionStartTracked(
        { postMessage: (message) => posted.push(message) },
        {
          task: 'Keep this task',
          orchestrator: { modelId: 'model-a', reasoningEffort: 'high' },
          worker: {
            mode: 'same-as-orchestrator',
            modelId: 'model-a',
            reasoningEffort: 'high',
          },
          validator: {
            mode: 'same-as-orchestrator',
            modelId: 'model-a',
            reasoningEffort: 'high',
          },
          scrutinyEnabled: true,
          userTestingEnabled: true,
        },
        true,
        'session-a',
        requests,
        timers,
        timedOut,
        () => `request-${++nextId}`,
      );

    expect(start()).toBe('request-1');
    expect(start()).toBeNull();
    expect(posted).toHaveLength(1);

    vi.advanceTimersByTime(MISSION_START_TIMEOUT_MS);
    expect(timedOut).toHaveBeenCalledWith('Keep this task');
    expect(requests.size).toBe(0);
    expect(start()).toBe('request-2');
    expect(posted).toHaveLength(2);
  });
});
