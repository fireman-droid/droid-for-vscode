export interface ActiveMissionWorkspaceSession {
  readonly sessionId: string | null;
  readonly missionRole: 'orchestrator' | 'worker' | null;
}

export interface MissionWorkspaceSessionActions {
  readonly select?: (sessionId: string) => boolean;
  readonly create?: () => void;
}

export type MissionWorkspaceObservation =
  | { readonly kind: 'mission'; readonly sessionId: string }
  | { readonly kind: 'normal'; readonly sessionId: string }
  | { readonly kind: 'ignore' };

export interface MissionWorkspaceHostSnapshot {
  readonly sessionId: string | null;
  readonly mission?: {
    readonly role: 'orchestrator' | 'worker' | null;
  };
  readonly sessions: {
    readonly status: string;
    readonly items: readonly {
      readonly id: string;
      readonly missionRole?: 'orchestrator' | 'worker';
    }[];
  };
}

export class MissionWorkspaceState {
  private previousNormalSessionId: string | null = null;
  private activeMissionSessionId: string | null = null;

  remember(active: ActiveMissionWorkspaceSession | undefined): void {
    if (active?.sessionId !== null && active?.sessionId !== undefined &&
        active.missionRole === null) {
      this.previousNormalSessionId = active.sessionId;
    }
  }

  activate(sessionId: string): void {
    this.activeMissionSessionId = sessionId;
  }

  openDraft(
    active: ActiveMissionWorkspaceSession | undefined,
    actions: MissionWorkspaceSessionActions,
  ): void {
    this.remember(active);
    if (active?.missionRole === 'orchestrator') {
      this.restoreNormal(actions);
    }
    this.activeMissionSessionId = null;
  }

  close(
    active: ActiveMissionWorkspaceSession | undefined,
    actions: MissionWorkspaceSessionActions,
  ): void {
    if (active?.missionRole === 'orchestrator' ||
        this.activeMissionSessionId !== null) {
      this.restoreNormal(actions);
    }
    this.activeMissionSessionId = null;
  }

  observe(snapshot: MissionWorkspaceHostSnapshot): MissionWorkspaceObservation {
    const { sessionId } = snapshot;
    const activeSummary =
      sessionId === null || snapshot.sessions.status !== 'ready'
        ? undefined
        : snapshot.sessions.items.find((item) => item.id === sessionId);
    const missionRole =
      snapshot.mission?.role ??
      (activeSummary === undefined ? null : activeSummary.missionRole);
    if (sessionId === null) return { kind: 'ignore' };
    if (missionRole === 'orchestrator') {
      this.activeMissionSessionId = sessionId;
      return { kind: 'mission', sessionId };
    }
    if (missionRole === undefined) {
      this.previousNormalSessionId = sessionId;
      this.activeMissionSessionId = null;
      return { kind: 'normal', sessionId };
    }
    return { kind: 'ignore' };
  }

  private restoreNormal(actions: MissionWorkspaceSessionActions): void {
    const restored =
      this.previousNormalSessionId !== null &&
      actions.select?.(this.previousNormalSessionId) === true;
    if (!restored) actions.create?.();
  }
}
