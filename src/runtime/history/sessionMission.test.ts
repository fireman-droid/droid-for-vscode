import { describe, expect, it } from 'vitest';

import { readMissionRoleFromTags, readSessionMission } from './sessionMission';

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

describe('durable Mission identity tags', () => {
  it('recognizes official Mission roles and retains explicit worker identity', () => {
    expect(readMissionRoleFromTags([
      { name: 'mission-session', metadata: { role: 'orchestrator', missionId: 'mission-1' } },
    ])).toBe('orchestrator');
    expect(readMissionRoleFromTags([{ name: 'mission-orchestrator' }])).toBe('orchestrator');
    expect(readMissionRoleFromTags([
      { name: 'mission-orchestrator' },
      { name: 'mission-session', metadata: { role: 'worker', missionId: 'mission-1' } },
    ])).toBe('worker');
    expect(readMissionRoleFromTags([
      { name: 'mission-session', metadata: { role: 'orchestrator' } },
      { name: 'decompSessionType', metadata: { value: 'worker' } },
    ])).toBe('worker');
  });

  it('does not infer an orchestrator from a Mission association alone', () => {
    expect(readMissionRoleFromTags([
      { name: 'mission-session', metadata: { missionId: 'mission-1' } },
    ])).toBeNull();
    expect(readMissionRoleFromTags(undefined)).toBeNull();
  });
});
