import type {
  MissionFeatureSnapshot,
  MissionSnapshotMessage,
} from '../../../shared/protocol/missionProtocol';
import type {
  MissionProgressSummary,
  MissionRuntimeFeature,
  RuntimeEvent,
} from '../../../runtime/runtimeEvents';
import { normalizeMissionEvent } from '../../../runtime/events/normalizeMissionEvent';
import { isStrictRecord } from '../../../shared/validation/strictValidation';

type MissionRuntimeEvent = Extract<RuntimeEvent, { type: `mission-${string}` }>;

export interface MissionValidatorState {
  readonly scrutinyEnabled: boolean;
  readonly userTestingEnabled: boolean;
}

interface WorkerState {
  readonly featureId?: string;
  readonly active: boolean;
}

/**
 * Host-owned Mission state. Raw Worker identities stop here; snapshots expose
 * only bounded feature presentation and capabilities.
 */
export class MissionSnapshotReducer {
  private revision = 0;
  private lifecycle: MissionSnapshotMessage['lifecycle'];
  private title: string | undefined;
  private features: readonly MissionRuntimeFeature[] = [];
  private progress: readonly MissionProgressSummary[] = [];
  private readonly workers = new Map<string, WorkerState>();
  private busyAction: MissionSnapshotMessage['controls']['busyAction'];
  private availability: MissionSnapshotMessage['availability'] = 'attached';
  private needsRefresh = false;

  constructor(private readonly validator: MissionValidatorState) {}

  hydrate(value: unknown): boolean {
    if (!isStrictRecord(value)) {
      return false;
    }
    const state = normalizeMissionEvent({
      type: 'mission_state_changed',
      state: ownValue(value, 'state'),
      ...(ownValue(value, 'updatedAt') === undefined
        ? {}
        : { updatedAt: ownValue(value, 'updatedAt') }),
    });
    const features = normalizeMissionEvent({
      type: 'mission_features_changed',
      features: ownValue(value, 'features'),
    });
    const progress = normalizeMissionEvent({
      type: 'mission_progress_entry',
      progressLog: ownValue(value, 'progressLog'),
    });
    if (
      state?.type !== 'mission-state' ||
      features?.type !== 'mission-features' ||
      progress?.type !== 'mission-progress'
    ) {
      return false;
    }
    this.apply(state);
    this.apply(features);
    this.apply(progress);
    const title = ownValue(value, 'title');
    if (typeof title === 'string' && title.length > 0) {
      this.title = title.slice(0, 256);
    }
    this.hydrateWorkers(ownValue(value, 'workerStates'));
    return true;
  }

  apply(event: MissionRuntimeEvent): boolean {
    switch (event.type) {
      case 'mission-state':
        return this.replaceLifecycle(event.lifecycle);
      case 'mission-features':
        return this.replaceFeatures(event.features);
      case 'mission-progress':
        return this.reconcileProgress(event.entries);
      case 'mission-heartbeat':
        return false;
      case 'mission-worker-started':
        return this.startWorker(event.workerSessionId);
      case 'mission-worker-completed':
        return this.completeWorker(event.workerSessionId);
    }
  }

  setBusyAction(action: MissionSnapshotMessage['controls']['busyAction']): boolean {
    if (this.busyAction === action) {
      return false;
    }
    this.busyAction = action;
    this.revision += 1;
    return true;
  }

  setAvailability(availability: MissionSnapshotMessage['availability']): boolean {
    if (this.availability === availability) {
      return false;
    }
    this.availability = availability;
    this.busyAction = undefined;
    this.revision += 1;
    return true;
  }

  requiresRefresh(): boolean {
    return this.needsRefresh;
  }

  currentRevision(): number {
    return this.revision;
  }

  clearRefreshRequest(): void {
    this.needsRefresh = false;
  }

  activeWorkerSessionId(): string | null {
    const active = [...this.workers.entries()].filter(([, state]) => state.active);
    return active.length === 1 ? active[0]![0] : null;
  }

  workerSessionIdForFeature(featureId: string): string | null {
    if (!this.features.some(({ id }) => id === featureId)) {
      return null;
    }
    const matches = [...this.workers.entries()].filter(
      ([, state]) => state.featureId === featureId,
    );
    return matches.length === 1 ? matches[0]![0] : null;
  }

  snapshot(): Omit<MissionSnapshotMessage, 'sequence'> {
    const currentFeatureId = this.currentFeatureId();
    const features = this.features.map((feature, order) =>
      this.projectFeature(feature, order),
    );
    const attached = this.availability === 'attached';
    const busy = this.busyAction !== undefined;
    return {
      type: 'mission.snapshot',
      protocolVersion: 25,
      scope: 'selected-chat',
      revision: this.revision,
      availability: this.availability,
      ...(this.lifecycle === undefined
        ? { presentationPhase: 'loading' as const }
        : { lifecycle: this.lifecycle }),
      ...(this.title === undefined ? {} : { title: this.title }),
      features,
      ...(currentFeatureId === undefined ? {} : { currentFeatureId }),
      completedFeatureCount: features.filter(({ status }) => status === 'completed')
        .length,
      controls: {
        canPause:
          attached &&
          !busy &&
          (this.lifecycle === 'running' || this.lifecycle === 'orchestrator_turn'),
        canResume: attached && !busy && this.lifecycle === 'paused',
        canStopCurrentFeature:
          attached &&
          !busy &&
          this.lifecycle === 'running' &&
          currentFeatureId !== undefined &&
          this.activeWorkerSessionId() !== null,
        ...(this.busyAction === undefined ? {} : { busyAction: this.busyAction }),
      },
      validator: this.validator,
    };
  }

  private replaceLifecycle(
    lifecycle: NonNullable<MissionSnapshotMessage['lifecycle']>,
  ): boolean {
    const settlesBusy =
      (this.busyAction === 'pause' && lifecycle === 'paused') ||
      (this.busyAction === 'resume' && lifecycle === 'running') ||
      (this.busyAction === 'stop' && lifecycle === 'paused');
    if (this.lifecycle === lifecycle && !settlesBusy) {
      return false;
    }
    this.lifecycle = lifecycle;
    if (settlesBusy) {
      this.busyAction = undefined;
    }
    this.revision += 1;
    return true;
  }

  private replaceFeatures(features: readonly MissionRuntimeFeature[]): boolean {
    if (sameFeatures(this.features, features)) {
      return false;
    }
    this.features = features.map((feature) => ({ ...feature }));
    this.revision += 1;
    return true;
  }

  private reconcileProgress(entries: readonly MissionProgressSummary[]): boolean {
    const prefixLength = Math.min(this.progress.length, entries.length);
    for (let index = 0; index < prefixLength; index += 1) {
      if (!sameProgressEntry(this.progress[index]!, entries[index]!)) {
        this.needsRefresh = true;
        return false;
      }
    }
    if (entries.length < this.progress.length) {
      this.needsRefresh = true;
      return false;
    }
    if (entries.length === this.progress.length) {
      return false;
    }
    const suffix = entries.slice(this.progress.length);
    this.progress = entries.map((entry) => ({ ...entry }));
    for (const entry of suffix) {
      this.applyProgressEntry(entry);
    }
    this.revision += 1;
    return true;
  }

  private applyProgressEntry(entry: MissionProgressSummary): void {
    if (entry.type === 'mission_accepted' && entry.title !== undefined) {
      this.title = entry.title.slice(0, 256);
      return;
    }
    if (
      (entry.type === 'worker_started' || entry.type === 'worker_selected_feature') &&
      entry.workerSessionId !== undefined
    ) {
      const current = this.workers.get(entry.workerSessionId);
      this.workers.set(entry.workerSessionId, {
        active: true,
        ...((entry.featureId ?? current?.featureId) === undefined
          ? {}
          : { featureId: entry.featureId ?? current?.featureId }),
      });
      return;
    }
    if (
      (entry.type === 'worker_completed' ||
        entry.type === 'worker_failed' ||
        entry.type === 'worker_paused') &&
      entry.workerSessionId !== undefined
    ) {
      const current = this.workers.get(entry.workerSessionId);
      this.workers.set(entry.workerSessionId, {
        active: false,
        ...((entry.featureId ?? current?.featureId) === undefined
          ? {}
          : { featureId: entry.featureId ?? current?.featureId }),
      });
    }
  }

  private startWorker(workerSessionId: string): boolean {
    const current = this.workers.get(workerSessionId);
    if (current?.active === true) {
      return false;
    }
    this.workers.set(workerSessionId, {
      active: true,
      ...(current?.featureId === undefined ? {} : { featureId: current.featureId }),
    });
    this.revision += 1;
    return true;
  }

  private completeWorker(workerSessionId: string): boolean {
    const current = this.workers.get(workerSessionId);
    if (current === undefined || !current.active) {
      return false;
    }
    this.workers.set(workerSessionId, {
      active: false,
      ...(current.featureId === undefined ? {} : { featureId: current.featureId }),
    });
    if (this.busyAction === 'stop') {
      this.busyAction = undefined;
    }
    this.revision += 1;
    return true;
  }

  private currentFeatureId(): string | undefined {
    const workerId = this.activeWorkerSessionId();
    if (workerId === null) {
      return undefined;
    }
    const worker = this.workers.get(workerId);
    if (
      worker?.featureId !== undefined &&
      this.features.some(
        ({ id, status }) => id === worker.featureId && status === 'in_progress',
      )
    ) {
      return worker.featureId;
    }
    const running = this.features.filter(({ status }) => status === 'in_progress');
    return running.length === 1 ? running[0]!.id : undefined;
  }

  private projectFeature(
    feature: MissionRuntimeFeature,
    order: number,
  ): MissionFeatureSnapshot {
    const hasWorker = this.workerSessionIdForFeature(feature.id) !== null;
    const title = feature.description.slice(0, 512);
    return {
      id: feature.id,
      order,
      title,
      status: feature.status,
      ...(feature.milestone === undefined
        ? {}
        : { milestone: feature.milestone.slice(0, 512) }),
      ...(hasWorker ? { workerViewAvailable: true } : {}),
    };
  }

  private hydrateWorkers(value: unknown): void {
    if (!isStrictRecord(value)) {
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        continue;
      }
      const state = ownValue(value, key);
      if (!isStrictRecord(state)) {
        continue;
      }
      this.startWorker(key);
      if (ownValue(state, 'completedAt') !== undefined) {
        this.completeWorker(key);
      }
    }
  }
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function sameFeatures(
  left: readonly MissionRuntimeFeature[],
  right: readonly MissionRuntimeFeature[],
): boolean {
  return (
    left.length === right.length &&
    left.every((feature, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        feature.id === candidate.id &&
        feature.description === candidate.description &&
        feature.status === candidate.status &&
        feature.skillName === candidate.skillName &&
        feature.milestone === candidate.milestone
      );
    })
  );
}

function sameProgressEntry(
  left: MissionProgressSummary,
  right: MissionProgressSummary,
): boolean {
  return (
    left.type === right.type &&
    left.timestamp === right.timestamp &&
    left.workerSessionId === right.workerSessionId &&
    left.featureId === right.featureId &&
    left.title === right.title &&
    left.exitCode === right.exitCode
  );
}
