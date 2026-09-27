import type { MissionControlSetupSnapshotMessage } from '../../shared/protocol/missionControlSetupProtocol';
import type { MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import { lifecycleTone, type MissionTone } from './catalogPresentation';

export function phaseTone(snapshot: MissionSnapshotMessage): MissionTone {
  if (snapshot.availability === 'detached' || snapshot.lifecycle === undefined) return 'muted';
  return lifecycleTone(snapshot.lifecycle);
}

export function featureTone(status: MissionSnapshotMessage['features'][number]['status']): MissionTone {
  switch (status) {
    case 'in_progress':
      return 'active';
    case 'completed':
      return 'done';
    case 'pending':
    case 'cancelled':
      return 'muted';
  }
}

export function describeSetupStatus(snapshot: MissionControlSetupSnapshotMessage): string {
  if (snapshot.phase === 'inspecting') return 'Inspecting repository readiness…';
  if (snapshot.phase === 'advisory') return 'Review the repository warning before continuing.';
  if (snapshot.phase === 'starting') return 'Starting Mission…';
  if (snapshot.phase === 'indeterminate') return 'Readiness could not be confirmed. Retry when ready.';
  if (snapshot.availability === 'ready') return 'Ready to inspect repository readiness and start.';
  if (snapshot.availability === 'busy') return 'Finish the current chat activity before starting.';
  if (snapshot.availability === 'loading') return 'Loading the selected chat setup…';
  if (snapshot.availability === 'error') return 'Mission setup could not be loaded.';
  return 'Select an available chat and trusted workspace to continue.';
}
export function describeReadinessWarning(warning: NonNullable<MissionControlSetupSnapshotMessage['readiness']>['warning']): string {
  switch (warning) {
    case 'no_git': return 'This workspace is not a Git repository.';
    case 'no_remote': return 'This repository has no configured remote.';
    case 'no_report': return 'No Agent Readiness report is available for this repository.';
    case 'low_score': return 'The latest Agent Readiness score is below the recommended level.';
  }
}
export function formatPhase(snapshot: MissionSnapshotMessage): string {
  if (snapshot.availability === 'detached') return 'Detached';
  if (snapshot.lifecycle === undefined) return 'Loading Mission state…';
  if (snapshot.lifecycle === 'awaiting_input') return 'Awaiting input';
  if (snapshot.lifecycle === 'orchestrator_turn') return 'Orchestrating';
  return snapshot.lifecycle[0]!.toUpperCase() + snapshot.lifecycle.slice(1);
}
export function formatFeatureStatus(status: MissionSnapshotMessage['features'][number]['status']): string {
  return status === 'in_progress' ? 'In progress' : status[0]!.toUpperCase() + status.slice(1);
}
export function createMissionRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
