import { afterEach, describe, expect, it, vi } from 'vitest';

import { MissionSnapshotReducer } from './MissionSnapshotReducer';
import { handleMissionCommand } from './controls';

afterEach(() => {
  vi.useRealTimers();
});

describe('handleMissionCommand', () => {
  it('isolates a rejected Pause from a replacement Mission', async () => {
    vi.useFakeTimers();
    let rejectPause!: (reason?: unknown) => void;
    const pause = new Promise<void>((_, reject) => {
      rejectPause = reject;
    });
    const mission = new MissionSnapshotReducer({
      scrutinyEnabled: true,
      userTestingEnabled: true,
    });
    mission.apply({ type: 'mission-state', lifecycle: 'running' });
    const emitted: unknown[] = [];
    const ctl = {
      missionState: { missionRuntime: mission },
      sessionState: {
        sessionId: 'mission-1',
        runtime: { interruptSession: () => pause },
      },
      turnState: { turn: null },
      interactions: { hasPending: () => false },
      emit: (value: unknown) => emitted.push(value),
      emitSessionDiagnostic: vi.fn(),
    };

    handleMissionCommand(ctl as never, {
      type: 'mission.pause',
      protocolVersion: 25,
      requestId: 'pause-1',
      scope: 'selected-chat',
      snapshotRevision: mission.currentRevision(),
    });
    expect(mission.snapshot().controls.busyAction).toBe('pause');

    const replacement = new MissionSnapshotReducer({
      scrutinyEnabled: true,
      userTestingEnabled: true,
    });
    ctl.missionState.missionRuntime = replacement;
    rejectPause();
    await Promise.resolve();

    expect(replacement.snapshot().controls.busyAction).toBeUndefined();
    expect(JSON.stringify(emitted)).not.toContain('"requestId":"pause-1"');
  });

  it('rejects a duplicate control while the first is settling', () => {
    vi.useFakeTimers();
    const mission = new MissionSnapshotReducer({
      scrutinyEnabled: true,
      userTestingEnabled: true,
    });
    mission.apply({ type: 'mission-state', lifecycle: 'running' });
    const emitted: unknown[] = [];
    const ctl = {
      missionState: { missionRuntime: mission },
      sessionState: {
        sessionId: 'mission-1',
        runtime: { interruptSession: () => new Promise<void>(() => {}) },
      },
      turnState: { turn: null },
      interactions: { hasPending: () => false },
      emit: (value: unknown) => emitted.push(value),
      emitSessionDiagnostic: vi.fn(),
    };
    const command = {
      type: 'mission.pause' as const,
      protocolVersion: 25 as const,
      requestId: 'pause-1',
      scope: 'selected-chat' as const,
      snapshotRevision: mission.currentRevision(),
    };
    handleMissionCommand(ctl as never, command);
    handleMissionCommand(ctl as never, {
      ...command,
      requestId: 'pause-2',
      snapshotRevision: mission.currentRevision(),
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        requestId: 'pause-2',
        status: 'rejected',
        rejectionCode: 'busy',
      }),
    );
  });
});
