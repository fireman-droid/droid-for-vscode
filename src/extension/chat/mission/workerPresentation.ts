import type { MissionProgressSummary, MissionRuntimeFeature } from '../../../runtime/runtimeEvents';
import type { MissionFeatureSnapshot, MissionLifecycle } from '../../../shared/protocol/missionProtocol';

/** A feature being in progress does not prove its worker is still running. */
export function missionWorkerStatus(
  workerId: string, active: boolean, lifecycle: MissionLifecycle | undefined,
  feature: MissionRuntimeFeature, progress: readonly MissionProgressSummary[],
): NonNullable<MissionFeatureSnapshot['workerStatus']> {
  let lastWorker = -1;
  let lastResume = -1;
  for (let index = 0; index < progress.length; index += 1) {
    const entry = progress[index]!;
    if (entry.workerSessionId === workerId ||
        (entry.type === 'mission_resumed' && entry.resumeWorkerSessionId === workerId)) lastWorker = index;
    if (entry.type === 'mission_resumed' || entry.type === 'mission_run_started') lastResume = index;
  }
  const entry = progress[lastWorker];
  if (entry?.type === 'worker_failed') return 'failed';
  if (entry?.type === 'worker_completed') return entry.exitCode === undefined || entry.exitCode === 0 ? 'finished' : 'failed';
  if (feature.status === 'completed' || feature.completedWorkerSessionId === workerId) return 'finished';
  if (entry?.type === 'worker_paused') {
    // Resuming the Mission does not prove this particular worker resumed yet.
    return lastResume > lastWorker && lifecycle !== 'paused' ? 'unknown' : 'paused';
  }
  if (lifecycle === 'paused') return 'paused';
  if (active && (entry?.type === 'worker_started' || entry?.type === 'worker_selected_feature' || entry?.type === 'mission_resumed') &&
      (lifecycle === 'running' || lifecycle === 'orchestrator_turn')) return 'running';
  return 'unknown';
}
