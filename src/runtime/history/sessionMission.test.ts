import { describe, expect, it } from 'vitest';

import { readSessionMission } from './sessionMission';

describe('readSessionMission', () => {
  const envelope = (
    result: Record<string, unknown>,
  ): Record<string, unknown> => ({
    result: { session: { messages: [] }, ...result },
  });

  it('projects the mission state and decomposition role', () => {
    expect(
      readSessionMission(
        envelope({
          mission: { state: 'running', extra: 'ignored' },
          decompSessionType: 'orchestrator',
        }),
      ),
    ).toEqual({ state: 'running', role: 'orchestrator' });
  });

  it('projects a worker session without a mission blob', () => {
    expect(
      readSessionMission(envelope({ decompSessionType: 'worker' })),
    ).toEqual({ state: null, role: 'worker' });
  });

  it('projects a mission state without a decomposition role', () => {
    expect(
      readSessionMission(envelope({ mission: { state: 'paused' } })),
    ).toEqual({ state: 'paused', role: null });
  });

  it('nullifies unknown states and roles instead of guessing', () => {
    expect(
      readSessionMission(
        envelope({
          mission: { state: 'exploded' },
          decompSessionType: 'supervisor',
        }),
      ),
    ).toBeNull();
    expect(
      readSessionMission(
        envelope({
          mission: { state: 42 },
          decompSessionType: 'worker',
        }),
      ),
    ).toEqual({ state: null, role: 'worker' });
  });

  it('returns null when the session carries no mission identity', () => {
    expect(readSessionMission(envelope({}))).toBeNull();
    expect(readSessionMission(envelope({ mission: null }))).toBeNull();
    expect(readSessionMission({})).toBeNull();
    expect(readSessionMission(undefined)).toBeNull();
  });
});
