import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionSwitchTimings,
  finishSessionSwitchTiming,
} from './sessionSwitchTimings';

describe('sessionSwitchTimings', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValue(250);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for activation and context, then emits all phase durations once', () => {
    const timings = createSessionSwitchTimings('resume');
    timings.initializeMs = 30;
    timings.historyMs = 70;

    expect(finishSessionSwitchTiming(timings)).toBeNull();
    timings.ready = true;
    expect(finishSessionSwitchTiming(timings)).toBeNull();
    timings.contextMs = 20;

    expect(finishSessionSwitchTiming(timings)).toEqual({
      level: 'info',
      name: 'host.perf.session-switch',
      attributes: {
        kind: 'resume',
        durationMs: 150,
        initializeMs: 30,
        historyMs: 70,
        contextMs: 20,
      },
    });
    expect(finishSessionSwitchTiming(timings)).toBeNull();
  });

  it('retains explicit null for a phase that does not apply', () => {
    const timings = createSessionSwitchTimings('new');
    timings.initializeMs = 25;
    timings.contextMs = 5;
    timings.ready = true;

    expect(
      finishSessionSwitchTiming(timings)?.attributes?.historyMs,
    ).toBeNull();
  });
});
